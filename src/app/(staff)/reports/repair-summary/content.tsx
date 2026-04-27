'use client'

import { useI18n } from '@/lib/i18n/context'
import { ReportPageShell } from '@/components/reports/ReportPageShell'
import { ReportTable, type ReportColumn } from '@/components/reports/ReportTable'
import { formatMoney, shortDate, shortDateTime } from '@/lib/format/money'
import type { RepairSummaryRow } from '@/lib/reports/repair-summary'

export default function RepairSummaryContent({
  from,
  to,
  rows,
  totals,
}: {
  from: string
  to: string
  rows: RepairSummaryRow[]
  totals: Record<string, number>
}) {
  const { t } = useI18n()
  const c = t.reports.repairSummary.columns
  const tt = t.reports.repairSummary.totals

  const columns: ReportColumn<RepairSummaryRow>[] = [
    {
      key: 'when',
      header: c.createdAt,
      render: (r) => shortDateTime(r.created_at),
    },
    {
      key: 'ticket',
      header: c.ticket,
      mono: true,
      render: (r) => r.ticket_number,
    },
    { key: 'cust', header: c.customer, render: (r) => r.customer_name },
    { key: 'svc', header: c.serviceType, render: (r) => r.service_type },
    { key: 'title', header: c.title, render: (r) => r.title },
    { key: 'status', header: c.status, render: (r) => r.status },
    {
      key: 'quote',
      header: c.quote,
      align: 'right',
      mono: true,
      render: (r) => formatMoney(r.quote_amount),
    },
    {
      key: 'deposit',
      header: c.deposit,
      align: 'right',
      mono: true,
      render: (r) => formatMoney(r.deposit_amount),
    },
    {
      key: 'paid',
      header: c.paid,
      align: 'right',
      mono: true,
      render: (r) => formatMoney(r.paid_amount),
    },
    {
      key: 'promised',
      header: c.promised,
      mono: true,
      render: (r) => shortDate(r.promised_date),
    },
  ]

  const totalsTiles = [
    { label: tt.tickets, value: String(totals.tickets ?? 0) },
    { label: tt.deposits, value: formatMoney(totals.deposits ?? 0) },
    { label: tt.collected, value: formatMoney(totals.collected ?? 0) },
  ]

  return (
    <ReportPageShell
      title={t.reports.landing.repairSummary.title}
      slug="repair-summary"
      from={from}
      to={to}
      totals={totalsTiles}
    >
      <ReportTable rows={rows} columns={columns} />
    </ReportPageShell>
  )
}
