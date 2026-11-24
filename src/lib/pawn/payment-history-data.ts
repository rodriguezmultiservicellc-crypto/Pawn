/**
 * Loads what the printed payment history shows. Server-only.
 *
 * Tenant-scoped: every query filters by `tenantId` on top of RLS. Caller
 * MUST gate with requireRoleInTenant() first.
 *
 * Returns null when the loan is not that shop's.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { en } from '@/lib/i18n/en'
import { es } from '@/lib/i18n/es'
import { loadTenantRules } from '@/lib/jurisdictions/load'
import { chargeModelOf, todayInTimezone } from '@/lib/jurisdictions/rules'
import { payoffFromLoan } from '@/lib/pawn/math'
import { buildPaymentHistory, type PaymentHistoryDoc } from './payment-history'

const OPEN = ['active', 'extended', 'partial_paid']

export async function loadPaymentHistory(args: {
  supabase: SupabaseClient<Database>
  tenantId: string
  loanId: string
}): Promise<PaymentHistoryDoc | null> {
  const { supabase, tenantId, loanId } = args

  const [loanRes, eventsRes, tenantRes, rules] = await Promise.all([
    supabase
      .from('loans')
      .select(
        'id, ticket_number, principal, interest_rate_monthly, min_monthly_charge, issue_date, due_date, term_days, status, customer:customers(first_name, last_name)',
      )
      .eq('id', loanId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle(),
    // One loan's events are far under the API's 1,000 rows; the limit is
    // stated so a pathological ticket fails loudly, not short.
    supabase
      .from('loan_events')
      .select(
        'id, reverses_event_id, event_type, occurred_at, amount, principal_paid, interest_paid, fees_paid, interest_waived, new_due_date, previous_due_date, legacy_ref',
      )
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
  const events = eventsRes.data ?? []
  if (events.length >= 1000) throw new Error('loan_events_too_many')

  const charge = chargeModelOf(rules)
  const today = todayInTimezone(rules.timezone)
  const isOpen = OPEN.includes(loan.status)
  const payoff = isOpen
    ? payoffFromLoan(
        {
          principal: loan.principal,
          interest_rate_monthly: loan.interest_rate_monthly,
          issue_date: loan.issue_date,
          min_monthly_charge: loan.min_monthly_charge,
        },
        events,
        today,
        charge,
      )
    : null

  const c = (loan as unknown as { customer: { first_name: string; last_name: string } | null }).customer
  return {
    history: buildPaymentHistory({
      issueDate: loan.issue_date,
      dueDate: loan.due_date,
      termDays: loan.term_days,
      periodDays: charge.periodDays,
      isOpen,
      events,
    }),
    ticket_number: loan.ticket_number ?? '',
    loan_principal: Number(loan.principal),
    customer_name: c ? `${c.first_name} ${c.last_name}`.trim() : '—',
    due_date: loan.due_date,
    interest_owed: payoff ? payoff.interestOutstanding : null,
    payoff: payoff ? payoff.payoff : null,
    printed_on: today,
    tenant,
    timezone: rules.timezone,
    i18n: { en, es },
  }
}
