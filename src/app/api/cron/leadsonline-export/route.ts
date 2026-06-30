/**
 * Cron — daily police-report (LeadsOnline) export.
 *
 * For every active pawn tenant with a configured police_report_format:
 *   1. Select the tenant's UNEXPORTED reportable compliance_log rows
 *      (exported_at IS NULL, event_type IN pawn_intake/buy_outright).
 *   2. Build the vendor CSV via the format dispatcher, enriched with the
 *      tenant's NCIC TYP codes (pawn_intake_categories.ncic_code).
 *   3. INSERT a frozen compliance_export_batches row holding the exact CSV.
 *   4. UPDATE the covered compliance_log rows SET exported_at /
 *      exported_format / exported_batch_id (allowed by the immutability
 *      trigger, which permits only those bookkeeping columns).
 *
 * Ordering is batch-INSERT-first, then stamp: a stamp failure leaves the
 * rows unexported (they re-export next run, producing a duplicate batch the
 * operator can spot) rather than silently marking transactions reported
 * with no artifact — under-reporting to law enforcement is the worse
 * failure mode than a rare duplicate.
 *
 * Idempotency: exported_at is the key. A second run finds zero unexported
 * rows for a tenant whose previous run fully succeeded.
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}` only. Vercel Cron sets this
 *       header when CRON_SECRET is configured at the project level.
 */

import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUnexportedPoliceReportRows } from '@/lib/reports/police-report'
import { buildNcicBySlug } from '@/lib/compliance/ncic'
import { dispatch } from '@/lib/compliance/police-report'
import type { PoliceReportFormat } from '@/types/database-aliases'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SUPPORTED_FORMATS: PoliceReportFormat[] = ['fl_leadsonline']

type TenantRow = {
  id: string
  name: string
  dba: string | null
  agency_store_id: string | null
  police_report_format: string | null
}

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) {
    return new NextResponse('unauthorized', { status: 401 })
  }

  const admin = createAdminClient()

  const { data: tenants, error: tenantErr } = await admin
    .from('tenants')
    .select('id, name, dba, agency_store_id, police_report_format')
    .eq('has_pawn', true)
    .eq('is_active', true)

  if (tenantErr) {
    return NextResponse.json({ ok: false, error: tenantErr.message }, { status: 502 })
  }

  const generatedAt = new Date().toISOString()
  const generated: Array<{
    tenant_id: string
    batch_id: string
    transactions: number
    rows: number
  }> = []
  const skipped: Array<{ tenant_id: string; reason: string }> = []

  for (const t of (tenants ?? []) as TenantRow[]) {
    const format = t.police_report_format as PoliceReportFormat | null
    if (!format || !SUPPORTED_FORMATS.includes(format)) {
      skipped.push({ tenant_id: t.id, reason: `unsupported_format:${format ?? 'none'}` })
      continue
    }

    let rows
    try {
      rows = await getUnexportedPoliceReportRows({ supabase: admin, tenantId: t.id })
    } catch (err) {
      skipped.push({
        tenant_id: t.id,
        reason: err instanceof Error ? err.message : 'query_failed',
      })
      continue
    }
    if (rows.length === 0) continue

    const ncicBySlug = await buildNcicBySlug({ supabase: admin, tenantIds: [t.id] })
    const storeId = t.agency_store_id?.trim() || t.id

    const exportResult = dispatch({ format, rows, tenantStoreId: storeId, ncicBySlug })

    const batchId = randomUUID()
    const rangeStart = rows[0].occurred_at
    const rangeEnd = rows[rows.length - 1].occurred_at

    // 1. Persist the frozen artifact first (never lose the file).
    const { error: insErr } = await admin.from('compliance_export_batches').insert({
      id: batchId,
      tenant_id: t.id,
      format,
      range_start: rangeStart,
      range_end: rangeEnd,
      transaction_count: exportResult.transactionCount,
      row_count: exportResult.rowCount,
      filename: exportResult.filename,
      csv_body: exportResult.body,
      generated_by: 'cron',
    })
    if (insErr) {
      console.error('[cron:leadsonline-export] batch insert failed', t.id, insErr.message)
      skipped.push({ tenant_id: t.id, reason: `batch_insert_failed:${insErr.message}` })
      continue
    }

    // 2. Stamp the covered rows as exported.
    const ids = rows.map((r) => r.id)
    const { error: stampErr } = await admin
      .from('compliance_log')
      .update({
        exported_at: generatedAt,
        exported_format: format,
        exported_batch_id: batchId,
      })
      .in('id', ids)
    if (stampErr) {
      console.error('[cron:leadsonline-export] mark-exported failed', t.id, stampErr.message)
      skipped.push({ tenant_id: t.id, reason: `mark_exported_failed:${stampErr.message}` })
      // Batch exists; rows will re-export next run (duplicate batch, visible).
    }

    // 3. Audit (system action, no acting user).
    const { error: auditErr } = await admin.from('audit_log').insert({
      tenant_id: t.id,
      user_id: null,
      action: 'compliance_export_generated',
      table_name: 'compliance_export_batches',
      record_id: batchId,
      changes: {
        format,
        transactions: exportResult.transactionCount,
        flattened_rows: exportResult.rowCount,
        range_start: rangeStart,
        range_end: rangeEnd,
        filename: exportResult.filename,
        via: 'cron',
      },
    })
    if (auditErr) {
      console.error('[cron:leadsonline-export] audit insert failed', t.id, auditErr.message)
    }

    generated.push({
      tenant_id: t.id,
      batch_id: batchId,
      transactions: exportResult.transactionCount,
      rows: exportResult.rowCount,
    })
  }

  return NextResponse.json({
    ok: true,
    generatedAt,
    generated: generated.length,
    batches: generated,
    skipped,
  })
}

function authorizeCron(req: NextRequest): boolean {
  const auth = req.headers.get('authorization')
  const expected = process.env.CRON_SECRET
  if (!auth || !expected) return false
  return auth === `Bearer ${expected}`
}
