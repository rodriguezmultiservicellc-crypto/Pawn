'use client'

import Link from 'next/link'
import { CaretLeft } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { DateRangePicker } from '@/components/reports/DateRangePicker'
import { ReportTable, type ReportColumn } from '@/components/reports/ReportTable'
import { formatMoney, shortDateTime } from '@/lib/format/money'
import type { TipRow, TipsByEmployee } from '@/lib/reports/tips'

export default function TipsReportContent({
  from,
  to,
  rows,
  byEmployee,
  total,
  names,
}: {
  from: string
  to: string
  rows: TipRow[]
  byEmployee: TipsByEmployee[]
  total: number
  names: Record<string, string>
}) {
  const { t } = useI18n()
  const r = t.reports.tips
  const who = (id: string | null) => (id && names[id]) || r.unknownEmployee

  const employeeColumns: ReportColumn<TipsByEmployee>[] = [
    { key: 'who', header: r.columns.employee, render: (e) => who(e.employee_id) },
    { key: 'count', header: r.columns.count, align: 'right', mono: true, render: (e) => String(e.count) },
    { key: 'total', header: r.columns.total, align: 'right', mono: true, render: (e) => formatMoney(e.total) },
  ]
  const tipColumns: ReportColumn<TipRow>[] = [
    { key: 'when', header: r.columns.when, render: (x) => shortDateTime(x.occurred_at) },
    {
      key: 'sale',
      header: r.columns.sale,
      mono: true,
      render: (x) => (
        <Link href={`/pos/sales/${x.sale_id}`} className="text-blue hover:text-blue-2 hover:underline">
          {x.sale_number ?? '—'}
        </Link>
      ),
    },
    { key: 'who', header: r.columns.employee, render: (x) => who(x.employee_id) },
    { key: 'card', header: r.columns.card, mono: true, render: (x) => (x.card_last4 ? `····${x.card_last4}` : '—') },
    { key: 'amount', header: r.columns.saleAmount, align: 'right', mono: true, render: (x) => formatMoney(x.sale_amount) },
    { key: 'tip', header: r.columns.tip, align: 'right', mono: true, render: (x) => formatMoney(x.tip) },
  ]

  return (
    <div className="space-y-5">
      <div>
        <Link href="/reports" className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground">
          <CaretLeft size={14} weight="regular" />
          {t.reports.title}
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-foreground">{t.reports.landing.tips.title}</h1>
        <p className="mt-1 text-sm text-muted">{r.subtitle}</p>
      </div>

      <DateRangePicker from={from} to={to} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-xs uppercase tracking-wide text-muted">{r.totals.total}</div>
          <div className="mt-1 font-mono text-xl font-bold text-foreground">{formatMoney(total)}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-xs uppercase tracking-wide text-muted">{r.totals.count}</div>
          <div className="mt-1 font-mono text-xl font-bold text-foreground">{rows.length}</div>
        </div>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-foreground">{r.byEmployee}</h2>
        <ReportTable rows={byEmployee} columns={employeeColumns} empty={r.empty} />
      </section>

      {rows.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground">{r.eachTip}</h2>
          <ReportTable rows={rows} columns={tipColumns} />
        </section>
      ) : null}
    </div>
  )
}
