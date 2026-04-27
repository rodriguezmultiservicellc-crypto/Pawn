'use client'

import { useI18n } from '@/lib/i18n/context'
import { ReportPageShell } from '@/components/reports/ReportPageShell'
import { ReportTable, type ReportColumn } from '@/components/reports/ReportTable'
import { formatMoney, shortDate } from '@/lib/format/money'
import type { InventoryTurnRow } from '@/lib/reports/inventory-turn'

export default function InventoryTurnContent({
  from,
  to,
  rows,
  totals,
}: {
  from: string
  to: string
  rows: InventoryTurnRow[]
  totals: Record<string, number>
}) {
  const { t } = useI18n()
  const c = t.reports.inventoryTurn.columns
  const tt = t.reports.inventoryTurn.totals

  const columns: ReportColumn<InventoryTurnRow>[] = [
    { key: 'sku', header: c.sku, mono: true, render: (r) => r.sku },
    { key: 'desc', header: c.description, render: (r) => r.description },
    { key: 'cat', header: c.category, render: (r) => r.category },
    { key: 'src', header: c.source, render: (r) => r.source },
    {
      key: 'cost',
      header: c.cost,
      align: 'right',
      mono: true,
      render: (r) => formatMoney(r.cost_basis),
    },
    {
      key: 'sale',
      header: c.sale,
      align: 'right',
      mono: true,
      render: (r) => formatMoney(r.sale_price),
    },
    {
      key: 'margin',
      header: c.margin,
      align: 'right',
      mono: true,
      render: (r) => formatMoney(r.margin),
    },
    {
      key: 'days',
      header: c.days,
      align: 'right',
      mono: true,
      render: (r) => String(r.days_in_stock),
    },
    {
      key: 'soldAt',
      header: c.soldAt,
      mono: true,
      render: (r) => shortDate(r.sold_at),
    },
  ]

  const avgDays = totals.avg_days_in_stock ?? 0
  const totalsTiles = [
    { label: tt.units, value: String(totals.units ?? 0) },
    { label: tt.revenue, value: formatMoney(totals.gross_revenue ?? 0) },
    { label: tt.margin, value: formatMoney(totals.gross_margin ?? 0) },
    { label: tt.avgDays, value: avgDays.toFixed(1) },
  ]

  return (
    <ReportPageShell
      title={t.reports.landing.inventoryTurn.title}
      slug="inventory-turn"
      from={from}
      to={to}
      totals={totalsTiles}
    >
      <ReportTable rows={rows} columns={columns} />
    </ReportPageShell>
  )
}
