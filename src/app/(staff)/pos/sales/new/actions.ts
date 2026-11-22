'use server'

import { revalidatePath } from 'next/cache'
import { layawayCreateSchema } from '@/lib/validations/pos'
import { logAudit } from '@/lib/audit'
import { externalCardSchema, type ExternalCard } from '@/lib/pos/card'
import {
  afterSaleCompleted,
  layawayCreate,
  posErrorKey,
  saleAddExternalCard,
  saleAddPayment,
  saleComplete,
} from '@/lib/pos/money'
import type { PaymentMethod } from '@/types/database-aliases'
import {
  counterContext,
  createRetailSale,
  parseRetail,
  readItems,
  toLines,
  type CounterContext,
  type IncomingItem,
} from './sale-core'

/**
 * Create-sale + create-layaway actions (Charge with cash or a card machine
 * slip). Charge on the card reader lives in reader-actions.ts; both share
 * sale-core.ts.
 *
 *   - retail  : sale_create (0076) → the tender → sale_complete, all in this
 *               request; the clerk stays on New sale. A refused step leaves
 *               the sale open and the clerk lands on its page.
 *   - layaway : sale + stock hold + layaway + down payment in one database
 *               transaction (layaway_create); redirect to /pos/layaways/[id].
 */

export type CreateSaleResult = {
  error?: string
  fieldErrors?: Record<string, string>
  redirectTo?: string
  /** Paid and completed at the counter: stay on New sale with an empty cart. */
  completed?: { saleId: string; saleNumber: string | null; total: number; tender: 'cash' | 'card' }
}

// ── Create sale (retail OR layaway) ────────────────────────────────────────

export async function createSaleAction(
  formData: FormData,
): Promise<CreateSaleResult> {
  const cc = await counterContext()
  if (!cc.ok) return { error: cc.error }
  const c = cc.c

  if (String(formData.get('sale_kind') ?? 'retail') === 'layaway') {
    return createLayawayInternal({
      formData,
      items: readItems(formData),
      userId: c.userId,
      tenantId: c.tenantId,
      registerSessionId: c.registerSessionId,
      supabase: c.supabase,
    })
  }

  // ── Retail sale ──
  const parsed = parseRetail(formData)
  if (!parsed.ok) return { error: parsed.error }

  // Card = a card machine slip (patches/0085). Checked BEFORE the sale is
  // written, so a typo never leaves an unpaid sale behind.
  let tender: CounterTender = { kind: 'cash' }
  if (formData.get('tender') === 'card') {
    const card = externalCardSchema.safeParse({
      last4: formData.get('card_last4') ?? '',
      brand: formData.get('card_brand') ?? '',
      auth_code: formData.get('card_auth_code'),
    })
    if (!card.success) return { error: 'cardDetailsInvalid' }
    tender = { kind: 'card', card: card.data }
  }

  // One database transaction (0076 sale_create): totals in cents, every
  // linked piece row-locked and still available — two registers cannot sell
  // the same item (REVIEW-2026-11-11 finding 13).
  const created = await createRetailSale(c, parsed.v)
  if (!created.ok) return { error: created.error }
  const sale = created.sale

  const settled = await settleAtCounter(c, sale.saleId, sale.total, tender)

  revalidatePath('/pos')
  revalidatePath('/pos/sales')
  // Done at the counter → ready for the next customer. A step that refused
  // leaves the sale open; the clerk finishes it on the sale page.
  if (settled) return { completed: { ...sale, tender: tender.kind } }
  return { redirectTo: `/pos/sales/${sale.saleId}` }
}

type CounterTender = { kind: 'cash' } | { kind: 'card'; card: ExternalCard }

// ── Create layaway (called via createSaleAction with sale_kind='layaway') ──

async function createLayawayInternal(args: {
  formData: FormData
  items: IncomingItem[]
  userId: string
  tenantId: string
  registerSessionId: string
  supabase: CounterContext['supabase']
}): Promise<CreateSaleResult> {
  const parsed = layawayCreateSchema.safeParse({
    customer_id: args.formData.get('customer_id'),
    tax_rate: args.formData.get('tax_rate'),
    tax_mode: args.formData.get('tax_mode'),
    discount_amount: args.formData.get('discount_amount'),
    schedule_kind: args.formData.get('schedule_kind') ?? 'weekly',
    down_payment: args.formData.get('down_payment'),
    down_payment_method:
      args.formData.get('down_payment_method') ?? 'cash',
    first_payment_due: args.formData.get('first_payment_due'),
    final_due_date: args.formData.get('final_due_date'),
    cancellation_fee_pct: args.formData.get('cancellation_fee_pct'),
    notes: args.formData.get('notes'),
    layaway_term_id: args.formData.get('layaway_term_id'),
    items: args.items,
  })
  if (!parsed.success) {
    return { error: 'customerRequiredForLayaway' }
  }
  const v = parsed.data
  if (v.items.length === 0) return { error: 'cartEmpty' }

  // Sale, lines, stock hold, layaway row and down payment in one database
  // transaction (patches/0076). A down payment at the layaway counter is
  // money in hand — a card here is run on the shop's own terminal, so it
  // counts now; there is no PaymentIntent waiting to settle.
  const r = await layawayCreate({
    tenantId: args.tenantId,
    userId: args.userId,
    registerSessionId: args.registerSessionId,
    customerId: v.customer_id,
    taxRate: v.tax_rate,
    taxMode: v.tax_mode,
    discount: v.discount_amount,
    notes: v.notes,
    items: toLines(v.items),
    scheduleKind: v.schedule_kind,
    downPayment: v.down_payment,
    downMethod: v.down_payment_method as PaymentMethod,
    firstPaymentDue: v.first_payment_due,
    finalDueDate: v.final_due_date,
    cancellationFeePct: v.cancellation_fee_pct,
  })
  if (!r.ok) return { error: posErrorKey(r.error) }

  await logAudit({
    tenantId: args.tenantId,
    userId: args.userId,
    action: 'layaway_create',
    tableName: 'layaways',
    recordId: r.data.layawayId,
    changes: {
      layaway_number: r.data.layawayNumber,
      sale_id: r.data.saleId,
      total_due: r.data.total,
      down_payment: v.down_payment,
      schedule_kind: v.schedule_kind,
      first_payment_due: v.first_payment_due,
      final_due_date: v.final_due_date,
      cancellation_fee_pct: v.cancellation_fee_pct,
      terms: await layawayTermsLabel(args.supabase, args.tenantId, v.layaway_term_id),
      completed: r.data.completed,
    },
  })
  if (r.data.completed) await afterSaleCompleted({ tenantId: args.tenantId, saleId: r.data.saleId })

  revalidatePath('/pos')
  revalidatePath('/pos/layaways')
  // ?print=1: the layaway page opens the print dialog, like a paid sale.
  return { redirectTo: `/pos/layaways/${r.data.layawayId}?print=1` }
}

/**
 * Name of the saved terms (patches/0093) the clerk picked, for the audit
 * trail. 'custom' when the terms were typed by hand.
 */
async function layawayTermsLabel(
  supabase: CounterContext['supabase'],
  tenantId: string,
  termId: string | null | undefined,
): Promise<string> {
  if (!termId) return 'custom'
  const { data } = await supabase
    .from('layaway_terms')
    .select('name')
    .eq('id', termId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  return data?.name ?? 'custom'
}

/**
 * Charge: record the tender for the full total and complete the sale,
 * through the same database functions the sale page uses (row locks, cents,
 * idempotent complete).
 *   cash  sale_add_payment
 *   card  sale_add_external_card_payment (0085) — the shop's card machine
 *         already approved it, so it counts at once.
 * If a step refuses, the sale stays OPEN and the clerk lands on its page,
 * where payment can be taken by hand — the sale itself is already saved, so
 * nothing is lost.
 */
async function settleAtCounter(
  args: { userId: string; tenantId: string },
  saleId: string,
  total: number,
  tender: CounterTender,
): Promise<boolean> {
  const { userId, tenantId } = args
  if (total > 0) {
    const paid =
      tender.kind === 'cash'
        ? await saleAddPayment({
            tenantId,
            userId,
            saleId,
            amount: total,
            method: 'cash',
            paymentIntentId: null,
            readerId: null,
            notes: null,
          })
        : await saleAddExternalCard({
            tenantId,
            userId,
            saleId,
            amount: total,
            last4: tender.card.last4,
            brand: tender.card.brand,
            authCode: tender.card.auth_code,
            notes: null,
          })
    if (!paid.ok) return false
    await logAudit({
      tenantId,
      userId,
      action: 'sale_payment_add',
      tableName: 'sale_payments',
      recordId: saleId,
      changes:
        tender.kind === 'cash'
          ? { amount: total, payment_method: 'cash', paid_total: paid.data.paidTotal, at: 'charge' }
          : {
              amount: total,
              payment_method: 'card',
              card_entry: 'external',
              card_brand: tender.card.brand,
              card_last4: tender.card.last4,
              paid_total: paid.data.paidTotal,
              at: 'charge',
            },
    })
  }
  const done = await saleComplete({ tenantId, userId, saleId })
  if (!done.ok || !done.data.completed) return false
  await logAudit({
    tenantId,
    userId,
    action: 'sale_complete',
    tableName: 'sales',
    recordId: saleId,
    changes: { total, at: 'charge' },
  })
  // Loyalty earn, referral, eBay end — same as completing on the sale page.
  await afterSaleCompleted({ tenantId, saleId })
  return true
}
