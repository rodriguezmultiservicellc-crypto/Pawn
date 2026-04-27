import { redirect } from 'next/navigation'
import { resolvePortalCustomer } from '@/lib/portal/customer'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripeLinkStatusBySessionId } from '@/lib/portal/stripe-payment-links'
import {
  daysBetween,
  payoffFromLoan,
  todayDateString,
} from '@/lib/pawn/math'
import LoanDetail, {
  type PortalLoanDetailView,
  type PortalLoanEventView,
} from './content'
import type {
  LoanEventRow,
  LoanEventType,
  LoanRow,
  LoanStatus,
} from '@/types/database-aliases'

export const dynamic = 'force-dynamic'

type Params = Promise<{ id: string }>
type SearchParams = Promise<{
  session_id?: string
  cancelled?: string
}>

export default async function PortalLoanDetailPage(props: {
  params: Params
  searchParams: SearchParams
}) {
  const { id } = await props.params
  const sp = await props.searchParams
  const { tenantId, customerId } = await resolvePortalCustomer()

  const admin = createAdminClient()

  const loanLookup = await admin
    .from('loans')
    .select(
      `id, tenant_id, customer_id, ticket_number, principal,
       interest_rate_monthly, term_days, issue_date, due_date, status,
       created_at, deleted_at,
       collateral:loan_collateral_items(id, description, position, deleted_at),
       events:loan_events(id, event_type, amount, principal_paid,
         interest_paid, fees_paid, payment_method, occurred_at, notes)`,
    )
    .eq('id', id)
    .maybeSingle()

  if (loanLookup.error || !loanLookup.data) redirect('/portal/loans')

  type LoanWithJoins = LoanRow & {
    collateral?: Array<{
      id: string
      description: string | null
      position: number | null
      deleted_at: string | null
    }> | null
    events?: Array<
      Pick<
        LoanEventRow,
        | 'id'
        | 'event_type'
        | 'amount'
        | 'principal_paid'
        | 'interest_paid'
        | 'fees_paid'
        | 'payment_method'
        | 'occurred_at'
        | 'notes'
      >
    > | null
  }
  const loan = loanLookup.data as unknown as LoanWithJoins

  if (loan.deleted_at) redirect('/portal/loans')
  if (loan.tenant_id !== tenantId) redirect('/portal/loans')
  if (loan.customer_id !== customerId) redirect('/portal/loans')

  const today = todayDateString()
  const events = (loan.events ?? []).map((e) => ({
    id: e.id,
    event_type: e.event_type as LoanEventType,
    amount: e.amount == null ? null : Number(e.amount),
    principal_paid: Number(e.principal_paid ?? 0),
    interest_paid: Number(e.interest_paid ?? 0),
    fees_paid: Number(e.fees_paid ?? 0),
    payment_method: e.payment_method,
    occurred_at: e.occurred_at,
    notes: e.notes,
  }))

  const payoff = payoffFromLoan(
    {
      principal: loan.principal,
      interest_rate_monthly: loan.interest_rate_monthly,
      issue_date: loan.issue_date,
    },
    events,
    today,
  )
  const daysToDue = daysBetween(today, loan.due_date)

  const collateral = (loan.collateral ?? [])
    .filter((c) => !c.deleted_at)
    .slice()
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((c) => c.description ?? '')
    .filter((s) => s.length > 0)

  const eventsView: PortalLoanEventView[] = events
    .slice()
    .sort((a, b) =>
      a.occurred_at < b.occurred_at ? 1 : a.occurred_at > b.occurred_at ? -1 : 0,
    )
    .map((e) => ({
      id: e.id,
      eventType: e.event_type,
      amount: e.amount,
      principal_paid: e.principal_paid,
      interest_paid: e.interest_paid,
      fees_paid: e.fees_paid,
      paymentMethod: e.payment_method,
      occurredAt: e.occurred_at,
      notes: e.notes,
    }))

  // Resolve banner state.
  let banner: 'success' | 'cancelled' | 'processing' | null = null
  if (sp.session_id) {
    const status = await getStripeLinkStatusBySessionId(sp.session_id)
    banner = status === 'paid' ? 'success' : 'processing'
  } else if (sp.cancelled) {
    banner = 'cancelled'
  }

  const view: PortalLoanDetailView = {
    id: loan.id,
    ticketNumber: loan.ticket_number ?? '',
    principal: Number(loan.principal),
    interestRateMonthly: Number(loan.interest_rate_monthly),
    termDays: loan.term_days,
    issueDate: loan.issue_date,
    dueDate: loan.due_date,
    daysToDue,
    status: loan.status as LoanStatus,
    payoff: payoff.payoff,
    principalOutstanding: payoff.principalOutstanding,
    interestAccrued: payoff.interestAccrued,
    collateralLines: collateral,
  }

  const isClosed =
    view.status === 'redeemed' ||
    view.status === 'forfeited' ||
    view.status === 'voided'

  return (
    <LoanDetail
      loan={view}
      events={eventsView}
      banner={banner}
      payoffEnabled={!isClosed && view.payoff > 0}
    />
  )
}
