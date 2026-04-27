'use client'

import { useI18n } from '@/lib/i18n/context'
import { ReportPageShell } from '@/components/reports/ReportPageShell'
import { ReportTable, type ReportColumn } from '@/components/reports/ReportTable'
import { formatMoney, shortDateTime } from '@/lib/format/money'
import type { DailyRegisterRow } from '@/lib/reports/daily-register'

export default function DailyRegisterContent({
  from,
  to,
  rows,
  totals,
}: {
  from: string
  to: string
  rows: DailyRegisterRow[]
  totals: Record<string, number>
  tenantName: string
}) {
  const { t } = useI18n()
  const c = t.reports.dailyRegister.columns
  const tt = t.reports.dailyRegister.totals

  const columns: ReportColumn<DailyRegisterRow>[] = [
    {
      key: 'opened',
      header: c.opened,
      render: (r) => shortDateTime(r.opened_at),
    },
    {
      key: 'closed',
      header: c.closed,
      render: (r) => shortDateTime(r.closed_at),
    },
    { key: 'status', header: c.status, render: (r) => r.status },
    {
      key: 'opening',
      header: c.openingCash,
      align: 'right',
      mono: true,
      render: (r) => formatMoney(r.opening_cash),
    },
    {
      key: 'cashSales',
      header: c.cashSales,
      align: 'right',
      mono: true,
      render: (r) => formatMoney(r.cash_sales),
    },
    {
      key: 'cashRefunds',
      header: c.cashRefunds,
      align: 'right',
      mono: true,
      render: (r) => formatMoney(r.cash_refunds),
    },
    {
      key: 'cardSales',
      header: c.cardSales,
      align: 'right',
      mono: true,
      render: (r) => formatMoney(r.card_sales),
    },
    {
      key: 'cardRefunds',
      header: c.cardRefunds,
      align: 'right',
      mono: true,
      render: (r) => formatMoney(r.card_refunds),
    },
    {
      key: 'expected',
      header: c.expectedCash,
      align: 'right',
      mono: true,
      render: (r) => formatMoney(r.expected_cash),
    },
    {
      key: 'counted',
      header: c.countedCash,
      align: 'right',
      mono: true,
      render: (r) => formatMoney(r.closing_cash_counted),
    },
    {
      key: 'variance',
      header: c.variance,
      align: 'right',
      mono: true,
      render: (r) => formatMoney(r.cash_variance),
    },
  ]

  const totalsTiles = [
    { label: tt.openingCash, value: formatMoney(totals.opening_cash ?? 0) },
    { label: tt.cashSales, value: formatMoney(totals.cash_sales ?? 0) },
    { label: tt.cardSales, value: formatMoney(totals.card_sales ?? 0) },
  ]

  return (
    <ReportPageShell
      title={t.reports.landing.dailyRegister.title}
      slug="daily-register"
      from={from}
      to={to}
      totals={totalsTiles}
    >
      <ReportTable rows={rows} columns={columns} />
    </ReportPageShell>
  )
}
