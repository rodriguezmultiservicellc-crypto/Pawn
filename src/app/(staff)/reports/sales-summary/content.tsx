'use client'

import { useI18n } from '@/lib/i18n/context'
import { ReportPageShell } from '@/components/reports/ReportPageShell'
import { ReportTable, type ReportColumn } from '@/components/reports/ReportTable'
import { formatMoney, shortDateTime } from '@/lib/format/money'
import type { SalesSummaryRow } from '@/lib/reports/sales-summary'

export default function SalesSummaryContent({
  from,
  to,
  rows,
  totals,
}: {
  from: string
  to: string
  rows: SalesSummaryRow[]
  totals: Record<string, number>
}) {
  const { t } = useI18n()
  const c = t.reports.salesSummary.columns
  const tt = t.reports.salesSummary.totals

  const columns: ReportColumn<SalesSummaryRow>[] = [
    {
      key: 'when',
      header: c.completedAt,
      render: (r) => shortDateTime(r.completed_at),
    },
    {
      key: 'sale',
      header: c.saleNumber,
      mono: true,
      render: (r) => r.sale_number,
    },
    {
      key: 'cust',
      header: c.customer,
      render: (r) => r.customer_name ?? '—',
    },
    { key: 'kind', header: c.kind, render: (r) => r.sale_kind },
    { key: 'status', header: c.status, render: (r) => r.status },
    {
      key: 'sub',
      header: c.subtotal,
      align: 'right',
      mono: true,
      render: (r) => formatMoney(r.subtotal),
    },
    {
      key: 'tax',
      header: c.tax,
      align: 'right',
      mono: true,
      render: (r) => formatMoney(r.tax_amount),
    },
    {
      key: 'disc',
      header: c.discount,
      align: 'right',
      mono: true,
      render: (r) => formatMoney(r.discount_amount),
    },
    {
      key: 'total',
      header: c.total,
      align: 'right',
      mono: true,
      render: (r) => formatMoney(r.total),
    },
    {
      key: 'returned',
      header: c.returned,
      align: 'right',
      mono: true,
      render: (r) => formatMoney(r.returned_total),
    },
    {
      key: 'net',
      header: c.net,
      align: 'right',
      mono: true,
      render: (r) => formatMoney(r.net),
    },
  ]

  const totalsTiles = [
    { label: tt.units, value: String(totals.units ?? 0) },
    { label: tt.total, value: formatMoney(totals.total ?? 0) },
    { label: tt.returned, value: formatMoney(totals.returned ?? 0) },
    { label: tt.net, value: formatMoney(totals.net ?? 0) },
  ]

  return (
    <ReportPageShell
      title={t.reports.landing.salesSummary.title}
      slug="sales-summary"
      from={from}
      to={to}
      totals={totalsTiles}
    >
      <ReportTable rows={rows} columns={columns} />
    </ReportPageShell>
  )
}
