'use client'

import { useI18n } from '@/lib/i18n/context'
import { ReportPageShell } from '@/components/reports/ReportPageShell'
import { ReportTable, type ReportColumn } from '@/components/reports/ReportTable'
import { formatMoney, shortDate } from '@/lib/format/money'
import type { PawnAgingRow } from '@/lib/reports/pawn-aging'
import type { Dictionary } from '@/lib/i18n/en'

export default function PawnAgingContent({
  from,
  to,
  rows,
  totals,
}: {
  from: string
  to: string
  rows: PawnAgingRow[]
  totals: Record<string, number>
}) {
  const { t } = useI18n()
  const c = t.reports.pawnAging.columns
  const buckets = t.reports.pawnAging.buckets

  const columns: ReportColumn<PawnAgingRow>[] = [
    {
      key: 'ticket',
      header: c.ticket,
      mono: true,
      render: (r) => r.ticket_number,
    },
    { key: 'customer', header: c.customer, render: (r) => r.customer_name },
    {
      key: 'principal',
      header: c.principal,
      align: 'right',
      mono: true,
      render: (r) => formatMoney(r.principal),
    },
    {
      key: 'dueDate',
      header: c.dueDate,
      mono: true,
      render: (r) => shortDate(r.due_date),
    },
    {
      key: 'daysToDue',
      header: c.daysToDue,
      align: 'right',
      mono: true,
      render: (r) => String(r.days_to_due),
    },
    { key: 'status', header: c.status, render: (r) => r.status },
    {
      key: 'bucket',
      header: c.bucket,
      render: (r) =>
        buckets[r.bucket as keyof Dictionary['reports']['pawnAging']['buckets']],
    },
  ]

  const totalsTiles = [
    {
      label: t.reports.pawnAging.totals.principal,
      value: formatMoney(totals.principal ?? 0),
    },
    { label: buckets.overdue, value: String(totals.overdue ?? 0) },
    { label: buckets.due_0_7, value: String(totals.due_0_7 ?? 0) },
    { label: buckets.due_15_30, value: String(totals.due_15_30 ?? 0) },
  ]

  return (
    <ReportPageShell
      title={t.reports.landing.pawnAging.title}
      slug="pawn-aging"
      from={from}
      to={to}
      totals={totalsTiles}
    >
      <ReportTable rows={rows} columns={columns} />
    </ReportPageShell>
  )
}
