'use client'

import Link from 'next/link'
import { useI18n } from '@/lib/i18n/context'
import { ClientTime } from '@/components/ClientTime'
import { ReportPageShell } from '@/components/reports/ReportPageShell'
import { ReportTable, type ReportColumn } from '@/components/reports/ReportTable'
import { formatMoney, fractionToPercent } from '@/lib/format/money'
import { isTaxExemptReason, TAX_LEVELS, type TaxLevel } from '@/lib/pos/sales-tax'
import type { SalesTaxDoc, SalesTaxLine, SalesTaxNoTaxGroup, SalesTaxReport } from '@/lib/reports/sales-tax'

export default function SalesTaxReportContent({
  from,
  to,
  report,
}: {
  from: string
  to: string
  report: SalesTaxReport
}) {
  const { t } = useI18n()
  const r = t.reports.salesTax
  const c = r.columns
  const { totals } = report

  const reasonLabel = (reason: string | null) =>
    reason == null ? r.noReason : isTaxExemptReason(reason) ? t.salesTax.exempt.reasons[reason] : reason
  const levelLabel = (level: string | null) =>
    level && (TAX_LEVELS as readonly string[]).includes(level) ? t.salesTax.levels[level as TaxLevel] : '—'
  const saleLink = (d: SalesTaxDoc) => (
    <Link href={`/pos/sales/${d.sale_id}`} className="text-blue hover:text-blue-2 hover:underline">
      {d.sale_number || '—'}
    </Link>
  )
  const money = (key: string, header: string, value: (x: SalesTaxLine) => number): ReportColumn<SalesTaxLine> => ({
    key,
    header,
    align: 'right',
    mono: true,
    render: (x) => formatMoney(value(x)),
  })

  const lineColumns: ReportColumn<SalesTaxLine>[] = [
    {
      key: 'name',
      header: c.line,
      render: (x) => (x.flat ? r.flatLine.replace('{rate}', fractionToPercent(x.rate)) : x.name),
    },
    { key: 'level', header: c.chargedBy, render: (x) => levelLabel(x.level) },
    { key: 'rate', header: c.rate, align: 'right', mono: true, render: (x) => `${fractionToPercent(x.rate)}%` },
    money('taxable', c.taxable, (x) => x.taxable),
    money('tax', c.tax, (x) => x.tax),
    money('rTaxable', c.refundedTaxable, (x) => x.refunded_taxable),
    money('rTax', c.taxRefunded, (x) => x.tax_refunded),
    money('netTaxable', c.netTaxable, (x) => x.net_taxable),
    money('netTax', c.netTax, (x) => x.net_tax),
  ]

  const noTaxColumns: ReportColumn<SalesTaxNoTaxGroup>[] = [
    { key: 'reason', header: c.reason, render: (g) => reasonLabel(g.reason) },
    { key: 'count', header: c.count, align: 'right', mono: true, render: (g) => String(g.count) },
    { key: 'amount', header: c.amount, align: 'right', mono: true, render: (g) => formatMoney(g.amount) },
  ]

  const noTaxSales = report.documents.filter((d) => d.kind === 'sale' && (d.exempt_reason != null || d.untaxed))
  const noTaxSaleColumns: ReportColumn<SalesTaxDoc>[] = [
    { key: 'when', header: c.when, render: (d) => <ClientTime iso={d.at} /> },
    { key: 'sale', header: c.sale, mono: true, render: saleLink },
    { key: 'cust', header: c.customer, render: (d) => d.customer_name ?? '—' },
    { key: 'reason', header: c.reason, render: (d) => reasonLabel(d.exempt_reason) },
    { key: 'cert', header: c.certificate, mono: true, render: (d) => d.certificate ?? '—' },
    { key: 'amount', header: c.amount, align: 'right', mono: true, render: (d) => formatMoney(d.before_tax) },
  ]

  const givenBack = report.documents.filter((d) => d.kind !== 'sale')
  const givenBackColumns: ReportColumn<SalesTaxDoc>[] = [
    { key: 'when', header: c.when, render: (d) => <ClientTime iso={d.at} /> },
    { key: 'type', header: c.type, render: (d) => (d.kind === 'void' ? r.kinds.void : r.kinds.return) },
    { key: 'number', header: c.number, mono: true, render: (d) => d.number || '—' },
    { key: 'sale', header: c.sale, mono: true, render: saleLink },
    { key: 'cust', header: c.customer, render: (d) => d.customer_name ?? '—' },
    { key: 'before', header: c.beforeTax, align: 'right', mono: true, render: (d) => formatMoney(d.before_tax) },
    { key: 'tax', header: c.taxRefunded, align: 'right', mono: true, render: (d) => formatMoney(d.tax) },
  ]

  const tiles = [
    { label: r.totals.gross, value: formatMoney(totals.gross) },
    { label: r.totals.noTax, value: formatMoney(totals.exempt + totals.untaxed) },
    { label: r.totals.taxable, value: formatMoney(totals.taxable) },
    { label: r.totals.collected, value: formatMoney(totals.tax_collected) },
    { label: r.totals.refunded, value: formatMoney(totals.tax_refunded) },
    { label: r.totals.net, value: formatMoney(totals.net_tax) },
  ]

  return (
    <ReportPageShell title={t.reports.landing.salesTax.title} slug="sales-tax" from={from} to={to} totals={tiles}>
      <p className="text-sm text-muted">{r.subtitle}</p>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-foreground">{r.byLine}</h2>
        <ReportTable rows={report.lines} columns={lineColumns} empty={r.emptyLines} />
      </section>

      {report.noTax.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground">{r.noTax}</h2>
          <ReportTable rows={report.noTax} columns={noTaxColumns} />
          {totals.untaxed > 0 ? <p className="text-xs text-muted">{r.noReasonHelp}</p> : null}
        </section>
      ) : null}

      {noTaxSales.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground">{r.noTaxSales}</h2>
          <ReportTable rows={noTaxSales} columns={noTaxSaleColumns} />
        </section>
      ) : null}

      {givenBack.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground">{r.givenBack}</h2>
          <ReportTable rows={givenBack} columns={givenBackColumns} />
        </section>
      ) : null}
    </ReportPageShell>
  )
}
