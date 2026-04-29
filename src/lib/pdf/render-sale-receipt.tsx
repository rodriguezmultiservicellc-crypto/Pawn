/**
 * Server-side renderer for the bilingual sale receipt PDF.
 *
 * Pure function: takes a saleId + tenantId + the user-scoped Supabase
 * client (RLS keeps queries tenant-scoped) and returns a Buffer the
 * route handler streams back to the browser.
 *
 * Caller MUST gate with requireRoleInTenant() before invoking — admin
 * paths aren't used here, so RLS does the heavy lifting, but the route
 * handler still owns the gate (defense in depth + audit logging).
 */

import { renderToBuffer } from '@react-pdf/renderer'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { en } from '@/lib/i18n/en'
import { es } from '@/lib/i18n/es'
import { todayDateString } from '@/lib/pawn/math'
import { registerPdfFonts } from './fonts'
import SaleReceiptPDF, {
  type SaleReceiptCustomer,
  type SaleReceiptData,
  type SaleReceiptItem,
  type SaleReceiptPayment,
  type SaleReceiptTenant,
} from './SaleReceiptPDF'

export type RenderSaleReceiptResult = {
  buffer: Buffer
  saleNumber: string
}

export async function renderSaleReceiptPdf(args: {
  supabase: SupabaseClient<Database>
  saleId: string
  tenantId: string
}): Promise<RenderSaleReceiptResult> {
  const { supabase, saleId, tenantId } = args

  // ── 1. Sale + customer (single round-trip)
  const { data: sale, error: saleErr } = await supabase
    .from('sales')
    .select(
      `id, tenant_id, sale_number, sale_kind, status, is_locked,
       subtotal, discount_amount, tax_rate, tax_amount, total, paid_total,
       notes, customer_id,
       customer:customers(first_name, last_name, middle_name, phone, email)`,
    )
    .eq('id', saleId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle()

  if (saleErr) throw new Error(`sale_lookup_failed: ${saleErr.message}`)
  if (!sale) throw new Error('sale_not_found')

  // ── 2. Tenant
  const { data: tenant, error: tenantErr } = await supabase
    .from('tenants')
    .select('id, name, dba, address, city, state, zip, phone, email')
    .eq('id', tenantId)
    .maybeSingle()
  if (tenantErr) throw new Error(`tenant_lookup_failed: ${tenantErr.message}`)
  if (!tenant) throw new Error('tenant_not_found')

  // ── 3. Sale items (with optional inventory join for SKU)
  const { data: itemRows } = await supabase
    .from('sale_items')
    .select(
      `description, quantity, unit_price, line_discount, line_total, position,
       inventory:inventory_items(sku)`,
    )
    .eq('sale_id', saleId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('position', { ascending: true })

  const items: SaleReceiptItem[] = (itemRows ?? []).map((r) => {
    const inv = (r as unknown as { inventory: { sku: string | null } | null })
      .inventory
    return {
      description: r.description,
      sku: inv?.sku ?? null,
      quantity: Number(r.quantity ?? 1),
      unit_price: Number(r.unit_price ?? 0),
      line_discount: Number(r.line_discount ?? 0),
      line_total: Number(r.line_total ?? 0),
    }
  })

  // ── 4. Payments
  const { data: paymentRows } = await supabase
    .from('sale_payments')
    .select('amount, payment_method, occurred_at')
    .eq('sale_id', saleId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('occurred_at', { ascending: true })

  const payments: SaleReceiptPayment[] = (paymentRows ?? []).map((p) => ({
    amount: Number(p.amount ?? 0),
    method: p.payment_method ?? 'other',
    occurred_at: p.occurred_at,
  }))

  // ── 5. Build customer view
  const c = (
    sale as unknown as {
      customer: {
        first_name: string
        last_name: string
        middle_name: string | null
        phone: string | null
        email: string | null
      } | null
    }
  ).customer

  const fullName = c
    ? [c.first_name, c.middle_name, c.last_name]
        .filter((s): s is string => Boolean(s && s.trim()))
        .join(' ')
    : null

  const customer: SaleReceiptCustomer | null = c
    ? {
        full_name: fullName,
        phone: c.phone,
        email: c.email,
      }
    : null

  const tenantView: SaleReceiptTenant = {
    name: tenant.name,
    dba: tenant.dba,
    address: tenant.address,
    city: tenant.city,
    state: tenant.state,
    zip: tenant.zip,
    phone: tenant.phone,
    email: tenant.email,
  }

  const data: SaleReceiptData = {
    sale_number: sale.sale_number ?? '',
    status: sale.status ?? 'open',
    is_locked: Boolean(sale.is_locked),
    sale_kind: sale.sale_kind ?? 'retail',
    subtotal: Number(sale.subtotal ?? 0),
    discount_amount: Number(sale.discount_amount ?? 0),
    tax_rate: Number(sale.tax_rate ?? 0),
    tax_amount: Number(sale.tax_amount ?? 0),
    total: Number(sale.total ?? 0),
    paid_total: Number(sale.paid_total ?? 0),
    notes: sale.notes ?? null,
    customer,
    tenant: tenantView,
    items,
    payments,
    i18n: { en, es },
    printed_on: todayDateString(),
  }

  registerPdfFonts()
  const buffer = await renderToBuffer(<SaleReceiptPDF data={data} />)
  return { buffer, saleNumber: data.sale_number }
}
