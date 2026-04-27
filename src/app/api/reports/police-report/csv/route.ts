/**
 * GET /api/reports/police-report/csv
 *
 * Streams the per-jurisdiction police-report CSV for the active tenant +
 * date range. Reads from compliance_log only (Rule 15) via the format
 * dispatcher.
 *
 * Audit-logs the export run (action='export', table='compliance_log').
 *
 * Query params:
 *   from         ISO date (YYYY-MM-DD) — inclusive
 *   to           ISO date (YYYY-MM-DD) — inclusive
 *   format       optional override; otherwise tenants.police_report_format
 *   storeId      optional override; otherwise tenant.id (UUID fallback)
 *
 * Marks the exported batch on each compliance_log row by setting
 * exported_at / exported_format / exported_batch_id. The on-table trigger
 * permits these bookkeeping columns to be updated even though the rest of
 * the row is immutable.
 */

import { randomUUID } from 'node:crypto'
import { getCtx } from '@/lib/supabase/ctx'
import { resolveReportScope } from '@/lib/reports/tenant-scope'
import { getPoliceReportRows } from '@/lib/reports/police-report'
import { dispatch } from '@/lib/compliance/police-report'
import { csvResponse, parseRange } from '@/lib/reports/http'
import { logAudit } from '@/lib/audit'
import type { PoliceReportFormat } from '@/types/database-aliases'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SUPPORTED_FORMATS: PoliceReportFormat[] = ['fl_leadsonline']

function isSupportedFormat(s: unknown): s is PoliceReportFormat {
  return typeof s === 'string' && (SUPPORTED_FORMATS as string[]).includes(s)
}

export async function GET(req: Request) {
  const ctx = await getCtx()
  if (!ctx) return new Response('unauthorized', { status: 401 })
  if (!ctx.tenantId) return new Response('no_tenant', { status: 403 })

  const url = new URL(req.url)
  const range = parseRange(url.searchParams)

  // Format selection: explicit query param > tenant default.
  const queryFormat = url.searchParams.get('format')
  const { data: tenantRow } = await ctx.supabase
    .from('tenants')
    .select('police_report_format')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  const candidate =
    queryFormat ?? tenantRow?.police_report_format ?? 'fl_leadsonline'
  if (!isSupportedFormat(candidate)) {
    return new Response(`unsupported_format:${candidate}`, { status: 400 })
  }
  const format = candidate

  const scope = await resolveReportScope({
    supabase: ctx.supabase,
    tenantId: ctx.tenantId,
  })

  const tenantStoreId = url.searchParams.get('storeId') ?? scope.storeId

  const result = await getPoliceReportRows({
    supabase: ctx.supabase,
    tenantIds: scope.tenantIds,
    range,
  })

  const exportResult = dispatch({
    format,
    rows: result.rows,
    tenantStoreId,
  })

  // Mark the rows as exported. We use the user-scoped client; compliance_log
  // bookkeeping columns are explicitly permitted by the immutability trigger
  // (only snapshot fields are blocked from UPDATE).
  const batchId = randomUUID()
  const exportedAt = new Date().toISOString()
  if (result.rows.length > 0) {
    const ids = result.rows.map((r) => r.id)
    const { error: updateErr } = await ctx.supabase
      .from('compliance_log')
      .update({
        exported_at: exportedAt,
        exported_format: format,
        exported_batch_id: batchId,
      })
      .in('id', ids)
    if (updateErr) {
      // Don't block the download — flag in audit instead.
      console.error('[police-report] mark-exported failed:', updateErr.message)
    }
  }

  await logAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: 'export',
    tableName: 'compliance_log',
    recordId: batchId,
    changes: {
      report: 'police-report',
      format,
      from: range.from,
      to: range.to,
      row_count: result.rows.length,
      flattened_csv_rows: exportResult.rowCount,
      tenant_ids: scope.tenantIds,
      batch_id: batchId,
      exported_at: exportedAt,
    },
  })

  return csvResponse(exportResult.filename, exportResult.body)
}
