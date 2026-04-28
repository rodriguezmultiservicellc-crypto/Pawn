'use client'

import Link from 'next/link'
import { CaretLeft, Receipt, FileCsv, Warning, HandCoins } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { formatMoney, shortDate } from '@/lib/format/money'
import type { Form1099Candidate } from '@/lib/reports/form-1099'

export default function Form1099Content({
  taxYear,
  currentYear,
  threshold,
  candidates,
  totalCandidatesAboveThreshold,
  totalPaidAcrossAll,
}: {
  taxYear: number
  currentYear: number
  threshold: number
  candidates: Form1099Candidate[]
  totalCandidatesAboveThreshold: number
  totalPaidAcrossAll: number
}) {
  const { t } = useI18n()
  const f = t.reports.form1099

  // Year selector: current year + previous two.
  const yearOptions = [currentYear, currentYear - 1, currentYear - 2]

  const csvHref = `/api/reports/1099/${taxYear}/csv?threshold=${threshold}`

  const headlineCandidates = f.candidatesAbove
    .replace('{count}', String(totalCandidatesAboveThreshold))
    .replace('{year}', String(taxYear))
    .replace('{threshold}', formatMoney(threshold))

  const headlineTotal = f.totalReportable.replace(
    '{amount}',
    formatMoney(
      candidates.reduce((acc, c) => acc + c.total_paid, 0),
    ),
  )

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link
            href="/reports"
            className="inline-flex items-center gap-1 text-xs text-ash hover:text-ink"
          >
            <CaretLeft size={14} weight="regular" />
            {t.reports.title}
          </Link>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold text-ink">
            <Receipt size={24} weight="regular" className="text-rausch" />
            {f.title}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-ash">{f.subtitle}</p>
        </div>
        <a
          href={csvHref}
          className="inline-flex items-center gap-2 rounded-md border border-hairline bg-canvas px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-cloud"
        >
          <FileCsv size={16} weight="regular" />
          {f.downloadCsv}
        </a>
      </div>

      {/* Year selector */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-ash">
          {f.taxYear}
        </span>
        {yearOptions.map((y) => {
          const isActive = y === taxYear
          return (
            <Link
              key={y}
              href={`/reports/1099?year=${y}`}
              className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'border-ink bg-ink text-canvas'
                  : 'border-hairline bg-canvas text-ink hover:bg-cloud'
              }`}
            >
              {y}
            </Link>
          )
        })}
        <span className="ml-2 text-xs text-ash">
          {f.threshold}: <span className="font-mono">{formatMoney(threshold)}</span>
        </span>
      </div>

      {/* Headline tiles */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-hairline bg-canvas p-4">
          <div className="text-xs uppercase tracking-wide text-ash">
            {f.candidatesAboveTile}
          </div>
          <div className="mt-1 font-mono text-2xl font-bold text-ink">
            {totalCandidatesAboveThreshold}
          </div>
          <p className="mt-1 text-xs text-ash">{headlineCandidates}</p>
        </div>
        <div className="rounded-lg border border-hairline bg-canvas p-4">
          <div className="text-xs uppercase tracking-wide text-ash">
            {f.totalReportableTile}
          </div>
          <div className="mt-1 font-mono text-2xl font-bold text-ink">
            {formatMoney(
              candidates.reduce((acc, c) => acc + c.total_paid, 0),
            )}
          </div>
          <p className="mt-1 text-xs text-ash">{headlineTotal}</p>
          {totalPaidAcrossAll > 0 ? (
            <p className="mt-1 text-xs text-ash">
              {f.totalAllPayouts.replace(
                '{amount}',
                formatMoney(totalPaidAcrossAll),
              )}
            </p>
          ) : null}
        </div>
      </div>

      {/* TIN reminder banner */}
      <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/5 p-4">
        <Warning
          size={20}
          weight="regular"
          className="mt-0.5 shrink-0 text-warning"
        />
        <div className="text-sm text-ink">
          <div className="font-medium">{f.tinReminderTitle}</div>
          <p className="mt-1 text-ash">{f.tinReminderBody}</p>
        </div>
      </div>

      {/* Empty state vs table */}
      {candidates.length === 0 ? (
        <div className="rounded-lg border border-hairline bg-canvas p-12 text-center">
          <HandCoins
            size={32}
            weight="regular"
            className="mx-auto text-ash/60"
          />
          <p className="mt-3 text-sm text-ash">{f.emptyState}</p>
          <Link
            href="/buy/new"
            className="mt-3 inline-block text-sm font-medium text-rausch hover:underline"
          >
            {f.viewBuy}
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-hairline bg-canvas">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-hairline text-ash">
              <tr>
                <th className="px-3 py-2 font-medium">{f.customer}</th>
                <th className="px-3 py-2 text-right font-medium">
                  {f.totalPaid}
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  {f.transactionCount}
                </th>
                <th className="px-3 py-2 font-medium">{f.firstDate}</th>
                <th className="px-3 py-2 font-medium">{f.lastDate}</th>
                <th className="px-3 py-2 font-medium">{f.idNumber}</th>
                <th className="px-3 py-2 font-medium">{f.address}</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c, i) => (
                <tr
                  key={c.customer_id ?? `unknown-${i}`}
                  className="border-b border-hairline last:border-0 hover:bg-cloud"
                >
                  <td className="px-3 py-2 align-top">
                    {c.customer_id && c.customer_active ? (
                      <Link
                        href={`/customers/${c.customer_id}`}
                        className="font-medium text-ink hover:underline"
                      >
                        {c.customer_name}
                      </Link>
                    ) : (
                      <span className="text-ink">{c.customer_name}</span>
                    )}
                    {c.current_phone || c.current_email ? (
                      <div className="mt-0.5 text-xs text-ash">
                        {[c.current_phone, c.current_email]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    ) : null}
                    {!c.customer_active && c.customer_id ? (
                      <div className="mt-0.5 text-xs text-error">
                        {f.customerDeleted}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right align-top font-mono">
                    {formatMoney(c.total_paid)}
                  </td>
                  <td className="px-3 py-2 text-right align-top font-mono">
                    {c.transaction_count}
                  </td>
                  <td className="px-3 py-2 align-top text-ash">
                    {shortDate(c.first_payment_date)}
                  </td>
                  <td className="px-3 py-2 align-top text-ash">
                    {shortDate(c.last_payment_date)}
                  </td>
                  <td className="px-3 py-2 align-top font-mono text-xs text-ash">
                    {c.id_number ?? '—'}
                  </td>
                  <td className="px-3 py-2 align-top text-xs text-ash">
                    {c.address || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
