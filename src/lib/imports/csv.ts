/**
 * Minimal RFC 4180 CSV parser (quote-aware: handles commas + newlines inside
 * quoted fields, and doubled "" escapes). Shared by the customer importer.
 * Whole-file parse — import files are a few MB at most.
 */

export type ParsedCsv = {
  headers: string[]
  /** Each row as { header: value }. Missing cells become ''. */
  rows: Array<Record<string, string>>
}

export function parseCsv(text: string): ParsedCsv {
  const grid = parseCsvGrid(text)
  const headers = (grid.shift() ?? []).map((h) => h.trim())
  const rows = grid
    .filter((r) => r.length > 1 || (r[0] ?? '').trim() !== '')
    .map((r) => {
      const o: Record<string, string> = {}
      headers.forEach((h, idx) => { o[h] = (r[idx] ?? '').trim() })
      return o
    })
  return { headers, rows }
}

/** Raw rows × cells, no header handling (headerless feeds, e.g. OFAC SDN). */
export function parseCsvGrid(text: string): string[][] {
  const s = text.replace(/^﻿/, '') // strip BOM
  const grid: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false

  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); grid.push(row); field = ''; row = [] }
    else if (c === '\r') { /* skip */ }
    else field += c
  }
  if (field !== '' || row.length) { row.push(field); grid.push(row) }
  return grid
}
