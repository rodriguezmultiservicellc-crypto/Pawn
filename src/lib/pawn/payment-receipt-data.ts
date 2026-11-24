/**
 * Loads what a pawn payment receipt prints. Server-only.
 *
 * Tenant-scoped: every query filters by `tenantId` on top of RLS. Caller
 * MUST gate with requireRoleInTenant() first.
 *
 * Returns null when the event is not a payment of that loan — the route
 * answers 404, it never prints a receipt for something that is not one.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { en } from '@/lib/i18n/en'
import { es } from '@/lib/i18n/es'
import { loadTenantRules } from '@/lib/jurisdictions/load'
import {
  paymentReceiptFacts,
  type PaymentGroupReceiptDoc,
  type PaymentReceiptDoc,
  type ReceiptEventInput,
} from './payment-receipt'

/**
 * The receipt of one "Pay together" (loan_events.payment_group_id): each
 * ticket's own receipt, in ticket-number order. Null when no payment of this
 * shop carries the id. Same gate as loadPaymentReceipt.
 */
export async function loadPaymentGroupReceipt(args: {
  supabase: SupabaseClient<Database>
  tenantId: string
  groupId: string
}): Promise<{ doc: PaymentGroupReceiptDoc; loanIds: string[] } | null> {
  const { supabase, tenantId, groupId } = args
  const { data, error } = await supabase
    .from('loan_events')
    .select('id, loan_id')
    .eq('tenant_id', tenantId)
    .eq('payment_group_id', groupId)
    .eq('event_type', 'payment')
  if (error) throw new Error(`payment_group_failed: ${error.message}`)
  if (!data || data.length === 0) return null
  const docs = await Promise.all(
    data.map((e) => loadPaymentReceipt({ supabase, tenantId, loanId: e.loan_id, eventId: e.id })),
  )
  const tickets = docs.filter((d): d is PaymentReceiptDoc => d != null)
  if (tickets.length === 0) return null
  tickets.sort((a, b) => a.ticket_number.localeCompare(b.ticket_number, 'en', { numeric: true }))
  return { doc: { tickets }, loanIds: [...new Set(data.map((e) => e.loan_id))] }
}

export async function loadPaymentReceipt(args: {
  supabase: SupabaseClient<Database>
  tenantId: string
  loanId: string
  eventId: string
}): Promise<PaymentReceiptDoc | null> {
  const { supabase, tenantId, loanId, eventId } = args

  const [loanRes, eventsRes, tenantRes, rules] = await Promise.all([
    supabase
      .from('loans')
      .select('id, ticket_number, principal, customer:customers(first_name, last_name)')
      .eq('id', loanId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle(),
    // Every event of the loan: the balance after a payment needs the ones
    // before it. One loan's events are far under the API's 1,000 rows, but
    // the limit is stated so a pathological ticket fails loudly, not short.
    supabase
      .from('loan_events')
      .select('id, event_type, amount, principal_paid, interest_paid, fees_paid, payment_method, new_due_date, occurred_at')
      .eq('loan_id', loanId)
      .eq('tenant_id', tenantId)
      .order('occurred_at', { ascending: true })
      .limit(1000),
    supabase
      .from('tenants')
      .select('name, dba, address, city, state, zip, phone')
      .eq('id', tenantId)
      .maybeSingle(),
    loadTenantRules(supabase, tenantId),
  ])

  if (loanRes.error) throw new Error(`loan_lookup_failed: ${loanRes.error.message}`)
  if (eventsRes.error) throw new Error(`loan_events_failed: ${eventsRes.error.message}`)
  if (tenantRes.error) throw new Error(`tenant_lookup_failed: ${tenantRes.error.message}`)
  const loan = loanRes.data
  const tenant = tenantRes.data
  if (!loan || !tenant) return null
  const events = (eventsRes.data ?? []) as ReceiptEventInput[]
  if (events.length >= 1000) throw new Error('loan_events_too_many')

  const facts = paymentReceiptFacts({ principal: loan.principal, events, eventId })
  if (!facts) return null

  const c = (loan as unknown as { customer: { first_name: string; last_name: string } | null }).customer
  return {
    ...facts,
    ticket_number: loan.ticket_number ?? '',
    loan_principal: Number(loan.principal),
    customer_name: c ? `${c.first_name} ${c.last_name}`.trim() : '—',
    tenant,
    timezone: rules.timezone,
    i18n: { en, es },
  }
}
