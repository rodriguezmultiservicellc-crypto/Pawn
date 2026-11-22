import 'server-only'

/**
 * Loads everything a sale receipt prints — one loader for every receipt
 * format (the bilingual PDF, and the Letter / Thermal print pages).
 *
 * Takes the user-scoped Supabase client, so RLS keeps every read inside the
 * tenant. Caller MUST gate with requireRoleInTenant() first.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { en } from '@/lib/i18n/en'
import { es } from '@/lib/i18n/es'
import { loadTenantRules } from '@/lib/jurisdictions/load'
import { todayInTimezone } from '@/lib/jurisdictions/rules'
import type {
  SaleReceiptCustomer,
  SaleReceiptData,
  SaleReceiptItem,
  SaleReceiptPayment,
} from '@/lib/pdf/SaleReceiptPDF'

export type SaleReceiptDoc = SaleReceiptData & {
  /** When the sale was completed (falls back to when it was opened). */
  issued_at: string
  /** The shop's IANA timezone — every printed time is in it, never UTC. */
  timezone: string
  /** Set when the sale is a layaway: its number and the agreed terms. */
  layaway: LayawayReceiptTerms | null
}

export type LayawayReceiptTerms = {
  layaway_number: string
  status: string
  schedule_kind: string
  first_payment_due: string | null
  final_due_date: string | null
  /** Fraction, e.g. 0.10 = 10% kept on cancellation. */
  cancellation_fee_pct: number
  balance_remaining: number
}

export async function loadSaleReceiptData(args: {
  supabase: SupabaseClient<Database>
  saleId: string
  tenantId: string
}): Promise<SaleReceiptDoc> {
  const { supabase, saleId, tenantId } = args

  const [saleRes, tenantRes, itemsRes, paymentsRes, rules] = await Promise.all([
    supabase
      .from('sales')
      .select(
        `id, tenant_id, sale_number, sale_kind, status, is_locked,
         subtotal, discount_amount, tax_rate, tax_amount, total, paid_total,
         notes, customer_id, created_at, completed_at,
         customer:customers(first_name, last_name, middle_name, phone, email)`,
      )
      .eq('id', saleId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle(),
    supabase
      .from('tenants')
      .select('id, name, dba, address, city, state, zip, phone, email')
      .eq('id', tenantId)
      .maybeSingle(),
    supabase
      .from('sale_items')
      .select(
        `description, quantity, unit_price, line_discount, line_total, position,
         inventory:inventory_items(sku)`,
      )
      .eq('sale_id', saleId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .order('position', { ascending: true }),
    supabase
      .from('sale_payments')
      .select('amount, payment_method, occurred_at, card_last4, card_brand, card_auth_code, tip_amount')
      .eq('sale_id', saleId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .order('occurred_at', { ascending: true }),
    loadTenantRules(supabase, tenantId),
  ])

  const { data: sale, error: saleErr } = saleRes
  if (saleErr) throw new Error(`sale_lookup_failed: ${saleErr.message}`)
  if (!sale) throw new Error('sale_not_found')
  const { data: tenant, error: tenantErr } = tenantRes
  if (tenantErr) throw new Error(`tenant_lookup_failed: ${tenantErr.message}`)
  if (!tenant) throw new Error('tenant_not_found')

  let layaway: LayawayReceiptTerms | null = null
  if (sale.sale_kind === 'layaway') {
    const { data: l } = await supabase
      .from('layaways')
      .select(
        'layaway_number, status, schedule_kind, first_payment_due, final_due_date, cancellation_fee_pct, balance_remaining',
      )
      .eq('sale_id', saleId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle()
    if (l) {
      layaway = {
        layaway_number: l.layaway_number ?? '',
        status: l.status,
        schedule_kind: l.schedule_kind,
        first_payment_due: l.first_payment_due,
        final_due_date: l.final_due_date,
        cancellation_fee_pct: Number(l.cancellation_fee_pct ?? 0),
        balance_remaining: Number(l.balance_remaining ?? 0),
      }
    }
  }

  const items: SaleReceiptItem[] = (itemsRes.data ?? []).map((r) => {
    const inv = (r as unknown as { inventory: { sku: string | null } | null }).inventory
    return {
      description: r.description,
      sku: inv?.sku ?? null,
      quantity: Number(r.quantity ?? 1),
      unit_price: Number(r.unit_price ?? 0),
      line_discount: Number(r.line_discount ?? 0),
      line_total: Number(r.line_total ?? 0),
    }
  })

  const payments: SaleReceiptPayment[] = (paymentsRes.data ?? []).map((p) => ({
    amount: Number(p.amount ?? 0),
    method: p.payment_method ?? 'other',
    occurred_at: p.occurred_at,
    card_last4: p.card_last4,
    card_brand: p.card_brand,
    card_auth_code: p.card_auth_code,
    tip: Number(p.tip_amount ?? 0),
  }))

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
  const customer: SaleReceiptCustomer | null = c
    ? {
        full_name:
          [c.first_name, c.middle_name, c.last_name]
            .filter((s): s is string => Boolean(s && s.trim()))
            .join(' ') || null,
        phone: c.phone,
        email: c.email,
      }
    : null

  return {
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
    tenant: {
      name: tenant.name,
      dba: tenant.dba,
      address: tenant.address,
      city: tenant.city,
      state: tenant.state,
      zip: tenant.zip,
      phone: tenant.phone,
      email: tenant.email,
    },
    items,
    payments,
    i18n: { en, es },
    printed_on: todayInTimezone(rules.timezone),
    issued_at: sale.completed_at ?? sale.created_at,
    timezone: rules.timezone,
    layaway,
  }
}
