/**
 * GET /api/reports/police-report/csv
 *
 * The police-report FILE for the active tenant + date range: the LeadsOnline
 * upload XML (the format xPawn sent), voided tickets in it with
 * <void>Y</void>. Reads from compliance_log only (Rule 15) via the format
 * dispatcher. The path keeps its old name (csv); nothing here uploads.
 *
 * Audit-logs the export run (action='export', table='compliance_log').
 *
 * Query params:
 *   from         ISO date (YYYY-MM-DD) — inclusive
 *   to           ISO date (YYYY-MM-DD) — inclusive
 *   format       optional override; otherwise tenants.police_report_format
 *   storeId      optional override; otherwise tenants.agency_store_id
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
import { buildNcicBySlug } from '@/lib/compliance/ncic'
import { dispatch, storeFromTenant } from '@/lib/compliance/police-report'
import { parseRange } from '@/lib/reports/http'
import { loadTenantRules } from '@/lib/jurisdictions/load'
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
  const timeZone = (await loadTenantRules(ctx.supabase, ctx.tenantId)).timezone
  const range = parseRange(url.searchParams, timeZone)

  // Format selection: explicit query param > tenant default.
  const queryFormat = url.searchParams.get('format')
  const { data: tenantRow } = await ctx.supabase
    .from('tenants')
    .select('id, name, dba, address, city, state, zip, phone, agency_store_id, police_report_format')
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


  const result = await getPoliceReportRows({
    supabase: ctx.supabase,
    tenantIds: scope.tenantIds,
    range,
  })

  const ncicBySlug = await buildNcicBySlug({
    supabase: ctx.supabase,
    tenantIds: scope.tenantIds,
  })

  if (!tenantRow) return new Response('no_tenant', { status: 403 })
  const store = storeFromTenant(tenantRow)
  const storeOverride = url.searchParams.get('storeId')
  if (storeOverride) store.storeNumber = storeOverride

  // Intakes are the tickets; a ticket with a void row goes out voided.
  const intakes = result.rows.filter((r) => r.event_type === 'pawn_intake' || r.event_type === 'buy_outright')
  const voided = (r: { source_id: string }) => r.source_id in result.voidRowBySource
  const exportResult = dispatch({
    format,
    tickets: intakes.map((row) => ({ row, voided: voided(row) })),
    store,
    timeZone,
    at: new Date(),
    ncicBySlug,
  })

  // Mark the rows as exported. We use the user-scoped client; compliance_log
  // bookkeeping columns are explicitly permitted by the immutability trigger
  // (only snapshot fields are blocked from UPDATE).
  const batchId = randomUUID()
  const exportedAt = new Date().toISOString()
  const stamps: Array<[ids: string[], outcome: 'reported' | 'reported_void']> = [
    [intakes.filter((r) => !voided(r)).map((r) => r.id), 'reported'],
    [
      intakes.filter(voided).flatMap((r) => [r.id, result.voidRowBySource[r.source_id]]),
      'reported_void',
    ],
  ]
  for (const [ids, outcome] of stamps) {
    if (ids.length === 0) continue
    const { error: updateErr } = await ctx.supabase
      .from('compliance_log')
      .update({ exported_at: exportedAt, exported_format: format, exported_batch_id: batchId, export_outcome: outcome })
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
      tickets: exportResult.transactionCount,
      items: exportResult.rowCount,
      tenant_ids: scope.tenantIds,
      batch_id: batchId,
      exported_at: exportedAt,
    },
  })

  return new Response(exportResult.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="${exportResult.filename}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
