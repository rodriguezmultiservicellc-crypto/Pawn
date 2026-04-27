/**
 * Shared types for the reports module.
 *
 * Each report exports its own row type plus a `getReport(...)` helper that
 * returns a Promise<Row[]>. PDFs and CSVs reuse the same row type so the
 * three surfaces (on-screen table / PDF / CSV) never drift.
 *
 * NOTE: Report queries always pass an explicit `tenantId` (or an array of
 * tenant IDs for cross-shop rollup). Never rely on RLS alone — defense in
 * depth per CLAUDE.md Rule 8.
 */

export type ReportRange = {
  /** Inclusive ISO date 'YYYY-MM-DD'. Treated as UTC midnight. */
  from: string
  /** Inclusive ISO date 'YYYY-MM-DD'. Treated as UTC midnight EOD when comparing timestamps (we compare against (to + 1 day) exclusive at query time). */
  to: string
}

export type ReportTotals = Record<string, number>

export type ReportResult<Row> = {
  rows: Row[]
  totals?: ReportTotals
  /** Tenant IDs that contributed rows. For chain-rollup reports this is the
   *  set of children; for single-tenant reports it's [tenantId]. */
  tenantIds: string[]
}
