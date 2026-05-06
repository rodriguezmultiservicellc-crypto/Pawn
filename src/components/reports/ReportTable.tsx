'use client'

import { useI18n } from '@/lib/i18n/context'

/**
 * Generic report-table renderer. Accepts a column definition (header label
 * + cell renderer) and a list of rows. Right-aligns numeric/money columns
 * via per-column `align` flag.
 *
 * Caps display at MAX_DISPLAY rows to keep the DOM responsive — the CSV
 * / PDF exports cover the full result set.
 */

export type ReportColumn<Row> = {
  key: string
  header: string
  align?: 'left' | 'right' | 'center'
  /** Optional fixed width in CSS units (e.g. "120px"). */
  width?: string
  /** Renderer. Receives the row + index. */
  render: (row: Row, index: number) => React.ReactNode
  /** When true, the cell uses the JetBrains Mono fallback for tabular figures. */
  mono?: boolean
}

const MAX_DISPLAY = 500

export function ReportTable<Row>({
  rows,
  columns,
  empty,
}: {
  rows: ReadonlyArray<Row>
  columns: ReadonlyArray<ReportColumn<Row>>
  empty?: string
}) {
  const { t } = useI18n()
  const visible = rows.slice(0, MAX_DISPLAY)
  const truncated = rows.length > MAX_DISPLAY

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-12 text-center text-muted">
        {empty ?? t.reports.empty}
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border text-muted">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={`px-3 py-2 font-medium ${
                  c.align === 'right'
                    ? 'text-right'
                    : c.align === 'center'
                      ? 'text-center'
                      : ''
                }`}
                style={c.width ? { width: c.width } : undefined}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((r, i) => (
            <tr
              key={i}
              className="border-b border-border last:border-0 hover:bg-background"
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`px-3 py-2 align-top ${
                    c.align === 'right'
                      ? 'text-right'
                      : c.align === 'center'
                        ? 'text-center'
                        : ''
                  } ${c.mono ? 'font-mono text-xs' : ''}`}
                >
                  {c.render(r, i)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {truncated ? (
        <div className="border-t border-border px-3 py-2 text-xs text-muted">
          {t.reports.truncated
            .replace('{shown}', String(MAX_DISPLAY))
            .replace('{total}', String(rows.length))}
        </div>
      ) : null}
    </div>
  )
}
