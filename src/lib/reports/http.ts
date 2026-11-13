/**
 * HTTP helpers shared by the report API routes.
 *
 * - parseRange(searchParams, timezone) — { from, to, timezone } from
 *   ?from=&to=, defaulting to the shop's today.
 * - csvResponse(filename, rows, columns) — stream a CSV response with
 *   RFC-4180 quoting + Content-Disposition: attachment.
 * - pdfResponse(filename, buffer) — stream a PDF response inline.
 *
 * CSV is intentionally simple: we don't bring in a library because the
 * volume per report is bounded (one tenant, one date range, ≤ ~100k rows
 * realistically). The escape rule is the standard one: any cell containing
 * a comma, double-quote, CR, or LF gets wrapped in double quotes with
 * inner quotes doubled.
 */

import type { ReportRange } from './types'
import { buildRange } from './range'

/**
 * ?from=&to= in the shop's day; missing dates default to the shop's today.
 * `timezone` comes from the tenant (loadTenantRules) — never UTC.
 */
export function parseRange(searchParams: URLSearchParams, timezone: string): ReportRange {
  return buildRange({ from: searchParams.get('from'), to: searchParams.get('to'), timezone })
}

export type CsvColumn<Row> = {
  header: string
  /** Either a row key, or a function producing the cell value. */
  value: keyof Row | ((row: Row) => string | number | null | undefined)
}

export function rowsToCsv<Row>(
  rows: ReadonlyArray<Row>,
  columns: ReadonlyArray<CsvColumn<Row>>,
): string {
  const headerLine = columns.map((c) => csvEscape(c.header)).join(',')
  const dataLines = rows.map((r) =>
    columns
      .map((c) => {
        const v =
          typeof c.value === 'function'
            ? c.value(r)
            : (r[c.value] as unknown as string | number | null | undefined)
        return csvEscape(formatCell(v))
      })
      .join(','),
  )
  return [headerLine, ...dataLines].join('\r\n') + '\r\n'
}

function formatCell(v: string | number | null | undefined): string {
  if (v == null) return ''
  if (typeof v === 'number') {
    if (!isFinite(v)) return ''
    return String(v)
  }
  return v
}

function csvEscape(s: string): string {
  if (s === '') return ''
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function csvResponse(filename: string, body: string): Response {
  // Prepend a UTF-8 BOM so Excel renders accented characters correctly.
  const payload = '﻿' + body
  return new Response(payload, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}

export function pdfResponse(filename: string, buffer: Buffer): Response {
  // Copy the Buffer into a fresh ArrayBuffer (TS otherwise widens to
  // ArrayBuffer | SharedArrayBuffer when constructing the Blob).
  const ab = new ArrayBuffer(buffer.byteLength)
  new Uint8Array(ab).set(buffer)
  const body = new Blob([ab], { type: 'application/pdf' })
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
