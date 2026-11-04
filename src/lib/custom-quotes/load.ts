import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { isExpired } from './math'
import type {
  CustomPieceCategory,
  CustomQuoteLineKind,
  CustomQuoteStatus,
} from '@/types/database-aliases'

/**
 * One loader for the quote detail page, the edit form, the PDF and the
 * convert action, so they all see the same numbers. Works with either the
 * user-scoped client (RLS) or the admin client (PDF route).
 */

export type QuoteLineView = {
  id: string
  kind: CustomQuoteLineKind
  position: number
  label: string
  quantity: number
  unit_cost: number
  unit_price: number
  cost_total: number
  price_total: number
  price_locked: boolean
  details: Record<string, unknown>
  inventory_item_id: string | null
}

export type QuoteDetailView = {
  id: string
  tenant_id: string
  quote_number: string
  status: CustomQuoteStatus
  /** status, or 'expired' when a draft/sent quote is past its date. */
  effective_status: CustomQuoteStatus
  customer_id: string
  customer_name: string
  customer_phone: string | null
  customer_email: string | null
  customer_language: 'en' | 'es'
  category: CustomPieceCategory
  description: string
  size: string | null
  reference_photo_path: string | null
  margin_pct: number
  cost_total: number
  price_total: number
  spot_priced_at: string | null
  spot_price_per_gram: number | null
  spot_metal_label: string | null
  deposit_pct: number
  deposit_amount: number
  balance_due: number
  payment_method: string | null
  expires_on: string | null
  sent_at: string | null
  accepted_at: string | null
  declined_at: string | null
  converted_at: string | null
  voided_at: string | null
  repair_ticket_id: string | null
  repair_ticket_number: string | null
  public_token: string | null
  notes_internal: string | null
  created_at: string
  updated_at: string
  lines: QuoteLineView[]
}

export async function loadQuoteDetail(args: {
  client: SupabaseClient<Database>
  tenantId: string
  quoteId: string
  /** Shop-local today (YYYY-MM-DD) for the expiry check. */
  today: string
}): Promise<QuoteDetailView | null> {
  const { client, tenantId, quoteId, today } = args
  const { data: q } = await client
    .from('custom_quotes')
    .select(
      `id, tenant_id, quote_number, status, customer_id, category, description, size,
       reference_photo_path, margin_pct, cost_total, price_total, spot_priced_at,
       spot_price_per_gram, spot_metal_label, deposit_pct, deposit_amount, balance_due,
       payment_method, expires_on, sent_at, accepted_at, declined_at, converted_at,
       voided_at, repair_ticket_id, public_token, notes_internal, created_at, updated_at,
       customer:customers(id, first_name, last_name, phone, email, language),
       ticket:repair_tickets(ticket_number)`,
    )
    .eq('id', quoteId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!q) return null

  const { data: lineRows } = await client
    .from('custom_quote_lines')
    .select(
      'id, kind, position, label, quantity, unit_cost, unit_price, cost_total, price_total, price_locked, details, inventory_item_id',
    )
    .eq('quote_id', quoteId)
    .eq('tenant_id', tenantId)
    .order('position')

  const c = (q as unknown as {
    customer: {
      id: string
      first_name: string
      last_name: string
      phone: string | null
      email: string | null
      language: string | null
    } | null
    ticket: { ticket_number: string | null } | null
  })

  const status = q.status as CustomQuoteStatus
  const effective_status: CustomQuoteStatus =
    (status === 'draft' || status === 'sent') && isExpired(q.expires_on, today)
      ? 'expired'
      : status

  return {
    id: q.id,
    tenant_id: q.tenant_id,
    quote_number: q.quote_number ?? '',
    status,
    effective_status,
    customer_id: q.customer_id,
    customer_name: c.customer ? `${c.customer.last_name}, ${c.customer.first_name}` : '—',
    customer_phone: c.customer?.phone ?? null,
    customer_email: c.customer?.email ?? null,
    customer_language: c.customer?.language === 'es' ? 'es' : 'en',
    category: q.category as CustomPieceCategory,
    description: q.description,
    size: q.size,
    reference_photo_path: q.reference_photo_path,
    margin_pct: Number(q.margin_pct),
    cost_total: Number(q.cost_total),
    price_total: Number(q.price_total),
    spot_priced_at: q.spot_priced_at,
    spot_price_per_gram: q.spot_price_per_gram == null ? null : Number(q.spot_price_per_gram),
    spot_metal_label: q.spot_metal_label,
    deposit_pct: Number(q.deposit_pct),
    deposit_amount: Number(q.deposit_amount),
    balance_due: Number(q.balance_due),
    payment_method: q.payment_method,
    expires_on: q.expires_on,
    sent_at: q.sent_at,
    accepted_at: q.accepted_at,
    declined_at: q.declined_at,
    converted_at: q.converted_at,
    voided_at: q.voided_at,
    repair_ticket_id: q.repair_ticket_id,
    repair_ticket_number: c.ticket?.ticket_number ?? null,
    public_token: q.public_token,
    notes_internal: q.notes_internal,
    created_at: q.created_at,
    updated_at: q.updated_at,
    lines: (lineRows ?? []).map((l) => ({
      id: l.id,
      kind: l.kind as CustomQuoteLineKind,
      position: l.position,
      label: l.label,
      quantity: Number(l.quantity),
      unit_cost: Number(l.unit_cost),
      unit_price: Number(l.unit_price),
      cost_total: Number(l.cost_total),
      price_total: Number(l.price_total),
      price_locked: l.price_locked,
      details: (l.details ?? {}) as Record<string, unknown>,
      inventory_item_id: l.inventory_item_id,
    })),
  }
}
