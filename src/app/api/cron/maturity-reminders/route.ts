/**
 * Cron — pawn-loan maturity reminders.
 *
 * For every tenant with `has_pawn = TRUE`, find active loans whose due_date
 * matches one of the reminder windows: T-7, T-1, T+0, T+1, T+7. For each
 * loan, dispatch a single reminder per (customer_id, kind, related_loan_id)
 * within a 24h idempotency window — re-running the cron the same day is safe.
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}` only. Vercel Cron sets the
 * Authorization header when CRON_SECRET is configured at the project level.
 * The `x-vercel-cron` header is NOT a security check — any external HTTP
 * caller can set it — so this route never trusts it.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { dispatchMessage } from '@/lib/comms/dispatch'
import { addDaysIso, payoffFromLoan, todayDateString } from '@/lib/pawn/math'
import type { LoanEventType, MessageKind } from '@/types/database-aliases'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TARGET_OFFSETS: Array<{ offset: number; kind: MessageKind }> = [
  { offset: -7, kind: 'loan_maturity_t7' }, // due_date = today + 7
  { offset: -1, kind: 'loan_maturity_t1' }, // due_date = today + 1
  { offset: 0, kind: 'loan_due_today' },    // due_date = today
  { offset: 1, kind: 'loan_overdue_t1' },   // due_date = today - 1
  { offset: 7, kind: 'loan_overdue_t7' },   // due_date = today - 7
]

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) return new NextResponse('unauthorized', { status: 401 })

  const admin = createAdminClient()
  const today = todayDateString()

  const { data: tenants } = await admin
    .from('tenants')
    .select('id')
    .eq('has_pawn', true)
    .eq('is_active', true)

  let queued = 0
  let skipped = 0
  let failed = 0

  for (const tenant of tenants ?? []) {
    for (const target of TARGET_OFFSETS) {
      // Loans where due_date == (today − offset). Negative offset = future.
      const dueDate = addDaysIso(today, -target.offset)

      const { data: loans } = await admin
        .from('loans')
        .select('id, tenant_id, customer_id, ticket_number, principal, interest_rate_monthly, issue_date, due_date, status')
        .eq('tenant_id', tenant.id)
        .eq('due_date', dueDate)
        .in('status', ['active', 'extended', 'partial_paid'])
        .is('deleted_at', null)

      for (const loan of loans ?? []) {
        // Idempotency: skip if any message_log for (customer, kind, loan)
        // exists in the last 24h.
        const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
        const recent = await checkRecentSend({
          tenantId: loan.tenant_id,
          customerId: loan.customer_id,
          relatedLoanId: loan.id,
          kind: target.kind,
          sinceIso: since,
        })
        if (recent) {
          skipped++
          continue
        }

        // Compute payoff for the {{amount}} variable.
        const events = await loadLoanEvents(loan.id)
        const payoff = payoffFromLoan(
          {
            principal: Number(loan.principal),
            interest_rate_monthly: Number(loan.interest_rate_monthly),
            issue_date: loan.issue_date,
          },
          events,
          today,
        )

        const res = await dispatchMessage({
          tenantId: loan.tenant_id,
          customerId: loan.customer_id,
          kind: target.kind,
          vars: {
            ticket_number: loan.ticket_number ?? '',
            due_date: loan.due_date,
            amount: formatUsd(payoff.payoff),
          },
          related: { loanId: loan.id },
        })
        if (res.ok) queued++
        else failed++
      }
    }
  }

  return NextResponse.json({ ok: true, today, queued, skipped, failed })
}

function authorizeCron(req: NextRequest): boolean {
  const auth = req.headers.get('authorization')
  if (!auth) return false
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  return auth === `Bearer ${expected}`
}

async function checkRecentSend(args: {
  tenantId: string
  customerId: string
  relatedLoanId: string
  kind: MessageKind
  sinceIso: string
}): Promise<boolean> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('message_log')
    .select('id')
    .eq('tenant_id', args.tenantId)
    .eq('customer_id', args.customerId)
    .eq('related_loan_id', args.relatedLoanId)
    .eq('kind', args.kind)
    .gte('created_at', args.sinceIso)
    .limit(1)
  return !!(data && data.length > 0)
}

async function loadLoanEvents(loanId: string) {
  const admin = createAdminClient()
  const { data } = await admin
    .from('loan_events')
    .select('event_type, principal_paid, interest_paid, fees_paid, occurred_at')
    .eq('loan_id', loanId)
    .order('occurred_at', { ascending: true })
  return (data ?? []).map((e) => ({
    event_type: e.event_type as LoanEventType,
    principal_paid: Number(e.principal_paid ?? 0),
    interest_paid: Number(e.interest_paid ?? 0),
    fees_paid: Number(e.fees_paid ?? 0),
    occurred_at: e.occurred_at,
  }))
}

function formatUsd(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}
