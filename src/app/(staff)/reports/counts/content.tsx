'use client'

import Link from 'next/link'
import { useI18n } from '@/lib/i18n/context'
import { ReportPageShell } from '@/components/reports/ReportPageShell'
import { ReportTable, type ReportColumn } from '@/components/reports/ReportTable'
import { formatMoney } from '@/lib/format/money'
import { absoluteTimestamp } from '@/lib/format/datetime'
import type { CountsReport, ShrinkageRow } from '@/lib/counts/report'
import { countScopeLabel } from '@/components/counts/labels'

type SessionRow = CountsReport['sessions'][number]

export default function CountsReportContent({
  from,
  to,
  report,
  isChainHq,
}: {
  from: string
  to: string
  report: CountsReport
  isChainHq: boolean
}) {
  const { t } = useI18n()
  const r = t.counts.report

  const shopColumns: ReportColumn<ShrinkageRow>[] = [
    { key: 'shop', header: r.shop, render: (x) => x.shopName },
    { key: 'counts', header: r.counts, align: 'right', mono: true, render: (x) => String(x.counts) },
    { key: 'missing', header: r.missing, align: 'right', mono: true, render: (x) => String(x.missingItems) },
    { key: 'missingValue', header: r.missingValue, align: 'right', mono: true, render: (x) => formatMoney(x.missingValue) },
    { key: 'writtenOff', header: r.writtenOff, align: 'right', mono: true, render: (x) => formatMoney(x.writtenOffValue) },
    {
      key: 'pledges',
      header: r.openPledges,
      align: 'right',
      mono: true,
      render: (x) => <span className={x.openPledges > 0 ? 'font-semibold text-danger' : ''}>{x.openPledges}</span>,
    },
  ]

  const sessionColumns: ReportColumn<SessionRow>[] = [
    {
      key: 'number',
      header: t.counts.list.number,
      mono: true,
      // A chain HQ cannot open a child shop's count page from its own context.
      render: (s) =>
        isChainHq ? (
          s.count_number
        ) : (
          <Link href={`/inventory/counts/${s.id}`} className="text-blue hover:text-blue-2">
            {s.count_number}
          </Link>
        ),
    },
    ...(isChainHq ? [{ key: 'shop', header: r.shop, render: (s: SessionRow) => s.shopName }] : []),
    { key: 'kind', header: t.counts.list.kind, render: (s) => t.counts.kinds[s.kind] },
    { key: 'scope', header: t.counts.list.scope, render: (s) => countScopeLabel(s, t) },
    { key: 'closed', header: t.counts.summary.closed, render: (s) => (s.closed_at ? absoluteTimestamp(s.closed_at) : '') },
    { key: 'seen', header: t.counts.list.progress, align: 'right', mono: true, render: (s) => `${s.seen_count ?? 0}/${s.expected_count ?? 0}` },
    { key: 'missing', header: t.counts.list.missing, align: 'right', mono: true, render: (s) => String(s.missing_count ?? 0) },
    { key: 'unexpected', header: t.counts.list.unexpected, align: 'right', mono: true, render: (s) => String(s.unexpected_count ?? 0) },
    { key: 'value', header: t.counts.list.value, align: 'right', mono: true, render: (s) => formatMoney(s.missing_value ?? 0) },
  ]

  const totals = [
    { label: r.counts, value: String(report.totals.counts) },
    { label: r.missing, value: String(report.totals.missingItems) },
    { label: r.missingValue, value: formatMoney(report.totals.missingValue) },
    { label: r.writtenOff, value: formatMoney(report.totals.writtenOffValue) },
  ]

  return (
    <ReportPageShell title={r.title} slug="counts" from={from} to={to} totals={totals}>
      <p className="text-sm text-muted">{r.subtitle}</p>
      <ReportTable rows={report.rows} columns={shopColumns} />
      <h2 className="pt-2 text-sm font-semibold text-foreground">{r.sessions}</h2>
      {report.sessions.length === 0 ? (
        <p className="rounded-xl border border-border bg-card px-5 py-4 text-sm text-muted">{r.empty}</p>
      ) : (
        <ReportTable rows={report.sessions} columns={sessionColumns} />
      )}
    </ReportPageShell>
  )
}
