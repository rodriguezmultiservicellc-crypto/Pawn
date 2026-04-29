/**
 * Server-side renderer for the bilingual buy-outright receipt PDF.
 *
 * Buy-outright transactions are stored in `compliance_log` (write-once,
 * see Rule 15 in CLAUDE.md). The route handler passes the *first
 * inventory_item_id* — the same anchor used by /buy/[id] page — and
 * we resolve the compliance row from there.
 *
 * Caller MUST gate with requireRoleInTenant() before invoking. Uses the
 * admin client because compliance_log RLS isn't tuned for tenant-staff
 * SELECTs everywhere yet, and the buy-receipt page itself uses admin.
 */

import { renderToBuffer } from '@react-pdf/renderer'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { en } from '@/lib/i18n/en'
import { es } from '@/lib/i18n/es'
import { todayDateString } from '@/lib/pawn/math'
import { registerPdfFonts } from './fonts'
import BuyReceiptPDF, {
  type BuyReceiptPDFCustomer,
  type BuyReceiptPDFData,
  type BuyReceiptPDFItem,
  type BuyReceiptPDFTenant,
} from './BuyReceiptPDF'

export type RenderBuyReceiptResult = {
  buffer: Buffer
  receiptNumber: string
}

export async function renderBuyReceiptPdf(args: {
  /** Service-role client. Compliance_log + customer-snapshot reads. */
  admin: SupabaseClient<Database>
  /** Anchor inventory_item_id (first item from the transaction). */
  anchorItemId: string
  tenantId: string
}): Promise<RenderBuyReceiptResult> {
  const { admin, anchorItemId, tenantId } = args

  // ── 1. Compliance log row
  const { data: complianceRow, error: clErr } = await admin
    .from('compliance_log')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('source_table', 'inventory_items')
    .eq('source_id', anchorItemId)
    .eq('event_type', 'buy_outright')
    .maybeSingle()

  if (clErr) throw new Error(`compliance_lookup_failed: ${clErr.message}`)
  if (!complianceRow) throw new Error('buy_transaction_not_found')

  // ── 2. Tenant
  const { data: tenant, error: tenantErr } = await admin
    .from('tenants')
    .select('id, name, dba, address, city, state, zip, phone, email')
    .eq('id', tenantId)
    .maybeSingle()
  if (tenantErr) throw new Error(`tenant_lookup_failed: ${tenantErr.message}`)
  if (!tenant) throw new Error('tenant_not_found')

  // ── 3. Tenant settings (for buy_hold_period_days)
  const { data: settings } = await admin
    .from('settings')
    .select('buy_hold_period_days')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  const holdPeriodDays =
    settings && typeof settings.buy_hold_period_days === 'number'
      ? settings.buy_hold_period_days
      : 30 // FL default; documented per CLAUDE.md domain spec

  // ── 4. Live item rows (for hold_until — we want the actual stamped value)
  const itemsSnap = (
    Array.isArray(complianceRow.items_snapshot)
      ? complianceRow.items_snapshot
      : []
  ) as Array<Record<string, unknown>>

  const itemIds = itemsSnap
    .map((it) =>
      typeof it.inventory_item_id === 'string' ? it.inventory_item_id : null,
    )
    .filter((x): x is string => !!x)

  let holdUntil: string | null = null
  if (itemIds.length > 0) {
    const { data: live } = await admin
      .from('inventory_items')
      .select('hold_until')
      .eq('tenant_id', tenantId)
      .in('id', itemIds)
    // Use the latest hold_until — items from the same transaction will
    // share a hold expiry but if any was overridden (e.g. legal hold)
    // we present the longest one, the most conservative.
    for (const r of live ?? []) {
      const hu = r.hold_until as string | null
      if (hu && (!holdUntil || hu > holdUntil)) holdUntil = hu
    }
  }

  // ── 5. Build customer view from snapshot
  const cs = (complianceRow.customer_snapshot ?? {}) as Record<
    string,
    unknown
  >
  const fullName = [cs.first_name, cs.middle_name, cs.last_name]
    .filter(
      (s): s is string => typeof s === 'string' && Boolean(s.trim()),
    )
    .join(' ')

  const customer: BuyReceiptPDFCustomer = {
    full_name: fullName || '—',
    id_type: typeof cs.id_type === 'string' ? cs.id_type : null,
    id_number: typeof cs.id_number === 'string' ? cs.id_number : null,
    phone: typeof cs.phone === 'string' ? cs.phone : null,
    email: typeof cs.email === 'string' ? cs.email : null,
    address:
      [cs.address1, cs.city, cs.state, cs.zip]
        .filter(
          (s): s is string => typeof s === 'string' && Boolean(s.trim()),
        )
        .join(', ') || '—',
    date_of_birth:
      typeof cs.date_of_birth === 'string' ? cs.date_of_birth : null,
  }

  const tenantView: BuyReceiptPDFTenant = {
    name: tenant.name,
    dba: tenant.dba,
    address: tenant.address,
    city: tenant.city,
    state: tenant.state,
    zip: tenant.zip,
    phone: tenant.phone,
    email: tenant.email,
  }

  const items: BuyReceiptPDFItem[] = itemsSnap.map((it) => ({
    description:
      typeof it.description === 'string' ? it.description : '—',
    sku: typeof it.sku === 'string' ? it.sku : null,
    category: typeof it.category === 'string' ? it.category : null,
    metal: typeof it.metal_type === 'string' ? it.metal_type : null,
    karat: typeof it.karat === 'string' ? it.karat : null,
    weight_grams:
      typeof it.weight_grams === 'number'
        ? it.weight_grams
        : typeof it.weight_grams === 'string'
          ? Number(it.weight_grams)
          : null,
    serial_number:
      typeof it.serial_number === 'string' ? it.serial_number : null,
    melt_value_at_buy:
      typeof it.melt_value_at_buy === 'number'
        ? it.melt_value_at_buy
        : null,
    payout:
      typeof it.payout === 'number'
        ? it.payout
        : typeof it.payout === 'string'
          ? Number(it.payout)
          : 0,
  }))

  const data: BuyReceiptPDFData = {
    transaction_id: complianceRow.id,
    occurred_at: complianceRow.occurred_at ?? complianceRow.created_at ?? null,
    total_payout:
      complianceRow.amount != null ? Number(complianceRow.amount) : 0,
    hold_period_days: holdPeriodDays,
    hold_until: holdUntil,
    customer,
    tenant: tenantView,
    items,
    i18n: { en, es },
    printed_on: todayDateString(),
  }

  registerPdfFonts()
  const buffer = await renderToBuffer(<BuyReceiptPDF data={data} />)
  // The PDF component formats this as 'BO-{last8}'; mirror it here so
  // the route handler can include it in the filename + audit log.
  const receiptNumber = `BO-${data.transaction_id.slice(-8).toUpperCase()}`
  return { buffer, receiptNumber }
}
