'use client'

import { useI18n } from '@/lib/i18n/context'
import { ReportPageShell } from '@/components/reports/ReportPageShell'
import { ReportTable, type ReportColumn } from '@/components/reports/ReportTable'
import { formatMoney, shortDateTime } from '@/lib/format/money'
import type { LoanActivityRow } from '@/lib/reports/loan-activity'

export default function LoanActivityContent({
  from,
  to,
  rows,
  totals,
}: {
  from: string
  to: string
  rows: LoanActivityRow[]
  totals: Record<string, number>
}) {
  const { t } = useI18n()
  const c = t.reports.loanActivity.columns
  const tt = t.reports.loanActivity.totals

  const columns: ReportColumn<LoanActivityRow>[] = [
    { key: 'when', header: c.when, render: (r) => shortDateTime(r.occurred_at) },
    {
      key: 'ticket',
      header: c.ticket,
      mono: true,
      render: (r) => r.ticket_number,
    },
    { key: 'customer', header: c.customer, render: (r) => r.customer_name },
    {
      key: 'eventType',
      header: c.eventType,
      render: (r) => r.event_type,
    },
    {
      key: 'amount',
      header: c.amount,
      align: 'right',
      mono: true,
      render: (r) => formatMoney(r.amount),
    },
    {
      key: 'principal',
      header: c.principalPaid,
      align: 'right',
      mono: true,
      render: (r) => formatMoney(r.principal_paid),
    },
    {
      key: 'interest',
      header: c.interestPaid,
      align: 'right',
      mono: true,
      render: (r) => formatMoney(r.interest_paid),
    },
    {
      key: 'fees',
      header: c.feesPaid,
      align: 'right',
      mono: true,
      render: (r) => formatMoney(r.fees_paid),
    },
  ]

  const totalsTiles = [
    { label: tt.redemptions, value: String(totals.redemptions ?? 0) },
    { label: tt.forfeitures, value: String(totals.forfeitures ?? 0) },
    { label: tt.interestIncome, value: formatMoney(totals.interest_income ?? 0) },
    {
      label: tt.principalCollected,
      value: formatMoney(totals.principal_collected ?? 0),
    },
  ]

  return (
    <ReportPageShell
      title={t.reports.landing.loanActivity.title}
      slug="loan-activity"
      from={from}
      to={to}
      totals={totalsTiles}
    >
      <ReportTable rows={rows} columns={columns} />
    </ReportPageShell>
  )
}
