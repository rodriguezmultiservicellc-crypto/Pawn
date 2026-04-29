import { resolvePortalCustomer } from '@/lib/portal/customer'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  daysBetween,
  payoffFromLoan,
  todayDateString,
} from '@/lib/pawn/math'
import type {
  LoanEventRow,
  LoanRow,
  LoanStatus,
} from '@/types/database-aliases'
import LoansList, {
  type PortalLoanView,
  type LoanStatusPill,
} from './content'

export const dynamic = 'force-dynamic'

/**
 * /portal/loans — list of the active client's pawn loans, with computed
 * payoff balance and a status pill (Active / Due Soon / Past Due / closed).
 *
 * Data fetch uses the admin client (RLS already mediates customer scoping
 * through the policies in 0009; the admin path keeps the layout consistent
 * with how the staff loan detail page behaves and avoids edge cases when
 * the client RLS policy depends on get_my_customer_id() which we already
 * resolved).
 */
export default async function PortalLoansPage() {
  const { tenantId, customerId } = await resolvePortalCustomer()
  const admin = createAdminClient()
  const today = todayDateString()

  const { data: loanRows } = await admin
    .from('loans')
    .select(
      `id, ticket_number, principal, interest_rate_monthly,
       min_monthly_charge, term_days, issue_date, due_date, status,
       created_at,
       collateral:loan_collateral_items(description, position),
       events:loan_events(principal_paid, interest_paid, fees_paid)`,
    )
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .is('deleted_at', null)
    .order('issue_date', { ascending: false })

  type CollateralLite = Pick<
    NonNullable<LoanRow>,
    never
  > & { description: string | null; position: number | null }
  type EventLite = Pick<
    LoanEventRow,
    'principal_paid' | 'interest_paid' | 'fees_paid'
  >
  type LoanWithJoins = LoanRow & {
    collateral?: CollateralLite[] | null
    events?: EventLite[] | null
  }

  const rows = (loanRows ?? []) as unknown as LoanWithJoins[]

  const loans: PortalLoanView[] = rows.map((l) => {
    const events = (l.events ?? []).filter(Boolean)
    const payoff = payoffFromLoan(
      {
        principal: l.principal,
        interest_rate_monthly: l.interest_rate_monthly,
        issue_date: l.issue_date,
        min_monthly_charge: l.min_monthly_charge,
      },
      events,
      today,
    )

    const collateral = (l.collateral ?? [])
      .slice()
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((c) => c.description ?? '')
      .filter((s) => s.length > 0)

    const collateralLine =
      collateral.length === 0
        ? '—'
        : collateral.length === 1
        ? collateral[0]
        : `${collateral[0]} +${collateral.length - 1}`

    const daysToDue = daysBetween(today, l.due_date)
    const statusPill = pillFromLoan(l.status as LoanStatus, daysToDue)

    return {
      id: l.id,
      ticketNumber: l.ticket_number ?? '',
      principal: Number(l.principal),
      payoff: payoff.payoff,
      interestAccrued: payoff.interestAccrued,
      issueDate: l.issue_date,
      dueDate: l.due_date,
      daysToDue,
      collateralLine,
      status: l.status as LoanStatus,
      statusPill,
    }
  })

  return <LoansList loans={loans} />
}

function pillFromLoan(
  status: LoanStatus,
  daysToDue: number,
): LoanStatusPill {
  if (status === 'redeemed') return 'redeemed'
  if (status === 'forfeited') return 'forfeited'
  if (status === 'voided') return 'voided'
  if (status === 'partial_paid') return 'partial_paid'
  if (status === 'extended' && daysToDue > 7) return 'extended'
  if (daysToDue < 0) return 'past_due'
  if (daysToDue <= 7) return 'due_soon'
  return 'active'
}
