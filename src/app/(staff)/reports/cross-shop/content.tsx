'use client'

import { useI18n } from '@/lib/i18n/context'
import { ReportPageShell } from '@/components/reports/ReportPageShell'
import { ReportTable, type ReportColumn } from '@/components/reports/ReportTable'
import { formatMoney } from '@/lib/format/money'
import type { CrossShopRow } from '@/lib/reports/cross-shop'

export default function CrossShopContent({
  from,
  to,
  rows,
  totals,
}: {
  from: string
  to: string
  rows: CrossShopRow[]
  totals: Record<string, number>
}) {
  const { t } = useI18n()
  const c = t.reports.crossShop.columns
  const tt = t.reports.crossShop.totals

  const columns: ReportColumn<CrossShopRow>[] = [
    { key: 'shop', header: c.shop, render: (r) => r.tenant_name },
    {
      key: 'active',
      header: c.activeLoans,
      align: 'right',
      mono: true,
      render: (r) => String(r.active_loans),
    },
    {
      key: 'principal',
      header: c.principalOutstanding,
      align: 'right',
      mono: true,
      render: (r) => formatMoney(r.loans_principal_outstanding),
    },
    {
      key: 'red',
      header: c.redemptions,
      align: 'right',
      mono: true,
      render: (r) => String(r.redemptions_in_range),
    },
    {
      key: 'forf',
      header: c.forfeitures,
      align: 'right',
      mono: true,
      render: (r) => String(r.forfeitures_in_range),
    },
    {
      key: 'int',
      header: c.interestIncome,
      align: 'right',
      mono: true,
      render: (r) => formatMoney(r.interest_income_in_range),
    },
    {
      key: 'salesCt',
      header: c.salesCount,
      align: 'right',
      mono: true,
      render: (r) => String(r.sales_count_in_range),
    },
    {
      key: 'salesTot',
      header: c.salesTotal,
      align: 'right',
      mono: true,
      render: (r) => formatMoney(r.sales_total_in_range),
    },
    {
      key: 'rep',
      header: c.repairTickets,
      align: 'right',
      mono: true,
      render: (r) => String(r.repair_tickets_in_range),
    },
    {
      key: 'units',
      header: c.unitsSold,
      align: 'right',
      mono: true,
      render: (r) => String(r.inventory_units_sold_in_range),
    },
    {
      key: 'invRev',
      header: c.inventoryRevenue,
      align: 'right',
      mono: true,
      render: (r) => formatMoney(r.inventory_revenue_in_range),
    },
  ]

  const totalsTiles = [
    { label: tt.activeLoans, value: String(totals.active_loans ?? 0) },
    {
      label: tt.principalOutstanding,
      value: formatMoney(totals.loans_principal_outstanding ?? 0),
    },
    { label: tt.salesTotal, value: formatMoney(totals.sales_total ?? 0) },
    {
      label: tt.interestIncome,
      value: formatMoney(totals.interest_income ?? 0),
    },
  ]

  return (
    <ReportPageShell
      title={t.reports.landing.crossShop.title}
      slug="cross-shop"
      from={from}
      to={to}
      totals={totalsTiles}
    >
      <ReportTable rows={rows} columns={columns} />
    </ReportPageShell>
  )
}
