/**
 * Police-report exporter dispatcher.
 *
 * Reads `tenants.police_report_format` and routes to the right format
 * module. v1 ships `fl_leadsonline` only; new states are added by:
 *
 *   1. Adding the format to the `police_report_format` Postgres ENUM
 *      (new migration + enum value).
 *   2. Adding it to the `PoliceReportFormat` TS alias in
 *      `src/types/database-aliases.ts`.
 *   3. Creating a new module under `formats/` exporting a
 *      `build<Format>Csv(rows, opts)` function with the same signature.
 *   4. Adding the case in `dispatch()` below.
 *
 * Per CLAUDE.md Rule 15 the data source is ALWAYS `compliance_log` —
 * never derive from loans/sales at report time.
 */

import type { ComplianceLogRow, PoliceReportFormat } from '@/types/database-aliases'
import { buildLeadsOnlineCsv } from './formats/fl-leadsonline'

export type PoliceReportExportInput = {
  format: PoliceReportFormat
  rows: ReadonlyArray<ComplianceLogRow>
  tenantStoreId: string
}

export type PoliceReportExportResult = {
  format: PoliceReportFormat
  body: string
  mimeType: 'text/csv'
  filename: string
  rowCount: number
}

export function dispatch(
  input: PoliceReportExportInput,
): PoliceReportExportResult {
  switch (input.format) {
    case 'fl_leadsonline': {
      const body = buildLeadsOnlineCsv(input.rows, {
        tenantStoreId: input.tenantStoreId,
      })
      return {
        format: input.format,
        body,
        mimeType: 'text/csv',
        filename: makeFilename('fl-leadsonline', input.rows),
        rowCount: input.rows.length,
      }
    }
    default: {
      // Exhaustiveness check: if a new format lands in the enum but not
      // here, this throws at runtime.
      const exhaustive: never = input.format
      throw new Error(
        `unsupported_police_report_format: ${exhaustive as string}`,
      )
    }
  }
}

function makeFilename(
  formatTag: string,
  rows: ReadonlyArray<ComplianceLogRow>,
): string {
  const min = rows.reduce(
    (acc, r) =>
      acc == null || r.occurred_at < acc ? r.occurred_at : acc,
    null as string | null,
  )
  const max = rows.reduce(
    (acc, r) =>
      acc == null || r.occurred_at > acc ? r.occurred_at : acc,
    null as string | null,
  )
  const lo = min ? min.slice(0, 10) : 'empty'
  const hi = max ? max.slice(0, 10) : 'empty'
  return `police-report-${formatTag}-${lo}_to_${hi}.csv`
}

export { buildLeadsOnlineCsv }
