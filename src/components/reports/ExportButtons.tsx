'use client'

import { FilePdf, FileCsv } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'

/**
 * Export buttons — render anchor links pointing at /api/reports/<slug>/{pdf,csv}
 * with the current ?from=&to= query string preserved.
 */
export function ExportButtons({
  slug,
  from,
  to,
  extra,
}: {
  slug: string
  from: string
  to: string
  /** Optional extra query params (e.g. format selector for police-report). */
  extra?: Record<string, string>
}) {
  const { t } = useI18n()
  const params = new URLSearchParams({ from, to, ...(extra ?? {}) })
  const qs = params.toString()
  return (
    <div className="flex items-center gap-2">
      <a
        href={`/api/reports/${slug}/pdf?${qs}`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-2 rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink hover:border-ink"
      >
        <FilePdf size={16} weight="regular" />
        {t.reports.actions.exportPdf}
      </a>
      <a
        href={`/api/reports/${slug}/csv?${qs}`}
        className="inline-flex items-center gap-2 rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink hover:border-ink"
      >
        <FileCsv size={16} weight="regular" />
        {t.reports.actions.exportCsv}
      </a>
    </div>
  )
}
