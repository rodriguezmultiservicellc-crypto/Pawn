import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadClerkInitials } from '@/lib/compliance/clerk'
import { logAudit } from '@/lib/audit'
import { issueForBuy as issueStoreCreditForBuy } from '@/lib/store-credit/events'
import { computeMeltValue, meltMetalFromItem, purityFromItem } from '@/lib/spot-prices/melt'
import { isSolidMetal } from '@/lib/spot-prices/purity'
import { r4 } from '@/lib/pawn/math'
import type { Tender } from '@/lib/metal-counter/math'
import { pledgorSnapshot, type PledgorSnapshotSource } from '@/lib/compliance/pledgor-snapshot'

/**
 * The end of every buy, whichever screen wrote it (Buy outright, or a
 * purchase on the transaction form — patches/0115): the police row, the
 * seller's store credit, the payout rows the drawer counts, the audit row.
 * The caller has already written the inventory items.
 *
 * Order matters:
 *   1. compliance_log (rule 15). Its trigger gives the buy its ticket number
 *      (BT-######). If it fails the buy must not stand: the items are
 *      withdrawn (soft delete) and the error goes back before anyone pays.
 *   2. Store credit, only after (1) — a buy that never reached the police
 *      ledger cannot leave credit behind.
 *   3. buy_payouts (rule 24: loadDrawerCash reads them).
 *   4. audit_log.
 */

/** What a piece was worth as metal when it was bought (police snapshot +
 *  analytics). A coated piece has none (patches/0067). */
export async function meltValueAtBuy(args: {
  tenantId: string
  metal: string | null
  karat: string | number | null
  coating: string | null
  weightGrams: number | null
}): Promise<number | null> {
  const meltMetal = isSolidMetal(args.coating) ? meltMetalFromItem(args.metal) : null
  if (!meltMetal || args.weightGrams == null) return null
  const purity = purityFromItem({ metal: args.metal, karat: args.karat })
  if (!purity) return null
  const melt = await computeMeltValue({
    metalType: meltMetal,
    purity,
    weightGrams: args.weightGrams,
    tenantId: args.tenantId,
  })
  return melt?.value ?? null
}

export type RecordBuyResult =
  | { ok: true; complianceId: string; ticketNumber: string }
  | { ok: false; error: string }

export async function recordBuy(args: {
  /** The clerk's client (role already checked). */
  supabase: SupabaseClient<Database>
  tenantId: string
  userId: string
  customer: PledgorSnapshotSource
  screeningId: string | null
  /** The inventory items just written, in ticket order, each with the
   *  police snapshot of the piece (must carry `payout`). */
  items: ReadonlyArray<{ id: string; sku: string; weight_grams: number | null; snapshot: Record<string, unknown> }>
  totalPayout: number
  paymentMethod: string
  tenders: ReadonlyArray<Tender>
  notes: string | null
  holdUntil: string | null
  /** A manager's confirmation of a stale spot price; null when fresh. */
  staleSpotAck: Record<string, unknown> | null
  /** Which screen wrote it, for the audit row. */
  flow: 'buy_outright' | 'purchase_form'
}): Promise<RecordBuyResult> {
  const { supabase, tenantId, userId, items } = args
  const first = items[0]
  if (!first) return { ok: false, error: 'no_items_inserted' }

  // 1. The police row — one per buy, every piece in items_snapshot.
  // source_id = the first item (the /buy/<id> page's anchor). No
  // reference_number: the trigger numbers the buy (patches/0115).
  const { data: complianceRow, error: complianceErr } = await supabase
    .from('compliance_log')
    .insert({
      tenant_id: tenantId,
      source_table: 'inventory_items',
      source_id: first.id,
      event_type: 'buy_outright',
      customer_snapshot: pledgorSnapshot(args.customer, args.screeningId),
      items_snapshot: items.map((it) => it.snapshot) as unknown as Json,
      amount: args.totalPayout,
      clerk: await loadClerkInitials(supabase, userId),
    })
    .select('id, reference_number')
    .single()
  if (complianceErr || !complianceRow) {
    console.error('[buy.record] compliance_log insert failed', complianceErr)
    await supabase
      .from('inventory_items')
      .update({ deleted_at: new Date().toISOString(), updated_by: userId })
      .in('id', items.map((it) => it.id))
      .eq('tenant_id', tenantId)
    return { ok: false, error: 'compliance_log_failed' }
  }
  const ticketNumber = complianceRow.reference_number ?? first.sku

  // 2. Paid in store credit (patches/0053). Idempotent per buy (keyed to the
  // anchor item). If it fails the buy still stands — its compliance row is
  // write-once — and the shop owes the seller: staff issues the credit from
  // the customer's panel.
  if (args.paymentMethod === 'store_credit') {
    const issued = await issueStoreCreditForBuy({
      admin: createAdminClient(),
      tenantId,
      customerId: args.customer.id,
      buyAnchorItemId: first.id,
      amount: args.totalPayout,
      performedBy: userId,
    })
    if (issued.ok === false) {
      console.error('[buy.record] store credit payout failed', issued.error)
      return { ok: false, error: 'store_credit_issue_failed' }
    }
  }

  // 3. What the seller was paid, one row per tender (patches/0113). Service
  // client after the role check — staff can only read this table. Logged
  // loudly on failure, never hidden.
  const { error: payoutErr } = await createAdminClient()
    .from('buy_payouts')
    .insert(
      args.tenders.map((tn) => ({
        tenant_id: tenantId,
        customer_id: args.customer.id,
        compliance_log_id: complianceRow.id,
        reference_number: ticketNumber,
        payout_method: tn.method,
        amount: tn.amount,
        paid_by: userId,
      })),
    )
  if (payoutErr) {
    console.error('[buy.record] buy_payouts insert failed — drawer will not count this payout', payoutErr)
  }

  // 4. Audit.
  await logAudit({
    tenantId,
    userId,
    action: 'buy_outright',
    tableName: 'inventory_items',
    recordId: first.id,
    changes: {
      flow: args.flow,
      ticket_number: ticketNumber,
      customer_id: args.customer.id,
      payment_method: args.paymentMethod,
      // One entry per tender; two for a mixed cash + transfer payout.
      tenders: args.tenders,
      total_payout: args.totalPayout,
      total_grams: r4(items.reduce((s, it) => s + (it.weight_grams ?? 0), 0)),
      item_count: items.length,
      hold_until: args.holdUntil,
      item_skus: items.map((it) => it.sku),
      notes: args.notes,
      stale_spot_ack: args.staleSpotAck,
    },
  })

  return { ok: true, complianceId: complianceRow.id, ticketNumber }
}
