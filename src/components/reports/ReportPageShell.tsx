'use client'

import { ReactNode } from 'react'
import Link from 'next/link'
import { CaretLeft } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { DateRangePicker } from './DateRangePicker'
import { ExportButtons } from './ExportButtons'

/**
 * Common shell for per-report pages. Provides the header, range picker,
 * export buttons, and totals strip; the caller passes the table body in
 * via `children`.
 */
export function ReportPageShell({
  title,
  slug,
  from,
  to,
  totals,
  exportExtra,
  children,
}: {
  title: string
  slug: string
  from: string
  to: string
  totals?: ReadonlyArray<{ label: string; value: string }>
  exportExtra?: Record<string, string>
  children: ReactNode
}) {
  const { t } = useI18n()
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Link
            href="/reports"
            className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground"
          >
            <CaretLeft size={14} weight="regular" />
            {t.reports.title}
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-foreground">{title}</h1>
        </div>
        <ExportButtons slug={slug} from={from} to={to} extra={exportExtra} />
      </div>

      <DateRangePicker from={from} to={to} />

      {totals && totals.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {totals.map((t, i) => (
            <div
              key={i}
              className="rounded-xl border border-border bg-card p-4"
            >
              <div className="text-xs uppercase tracking-wide text-muted">
                {t.label}
              </div>
              <div className="mt-1 font-mono text-lg font-bold text-foreground">
                {t.value}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {children}
    </div>
  )
}
