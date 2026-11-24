import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { allRows, chunks } from '@/lib/reports/all-rows'
import type { LoanMoneyEvent } from '@/lib/pawn/math'

/**
 * Every event of a set of loans, as the payoff reads them, grouped by loan.
 *
 * One loader for every screen that figures what a whole book of tickets owes
 * (the pawn list, the dashboard, collections). It pages (CLAUDE.md rule 22):
 * the API stops at 1,000 rows without saying so, and a payment left out
 * would overstate what that customer owes. It throws when a page fails — a
 * wrong balance is worse than an error.
 *
 * Pass `tenantId` to filter by shop on top of RLS (required with the admin
 * client; welcome anywhere).
 */
export async function loadLoanMoneyEvents(
  supabase: SupabaseClient<Database>,
  loanIds: ReadonlyArray<string>,
  tenantId?: string,
): Promise<Map<string, LoanMoneyEvent[]>> {
  type Row = {
    id: string
    reverses_event_id: string | null
    loan_id: string
    principal_paid: number | string | null
    interest_paid: number | string | null
    fees_paid: number | string | null
    interest_waived: number | string | null
    occurred_at: string
  }
  const byLoan = new Map<string, LoanMoneyEvent[]>()
  for (const ids of chunks(loanIds)) {
    const rows = await allRows<Row>('loan_events', (from, to) => {
      let q = supabase
        .from('loan_events')
        .select(
          'id, reverses_event_id, loan_id, principal_paid, interest_paid, fees_paid, interest_waived, occurred_at',
        )
        .in('loan_id', ids)
      if (tenantId) q = q.eq('tenant_id', tenantId)
      return q.order('id').range(from, to)
    })
    for (const e of rows) {
      const event: LoanMoneyEvent = {
        id: e.id,
        reverses_event_id: e.reverses_event_id,
        principal_paid: Number(e.principal_paid ?? 0),
        interest_paid: Number(e.interest_paid ?? 0),
        fees_paid: Number(e.fees_paid ?? 0),
        interest_waived: Number(e.interest_waived ?? 0),
        occurred_at: e.occurred_at,
      }
      const list = byLoan.get(e.loan_id)
      if (list) list.push(event)
      else byLoan.set(e.loan_id, [event])
    }
  }
  return byLoan
}
