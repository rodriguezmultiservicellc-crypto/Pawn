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
import { planPoliceExport } from '@/lib/compliance/police-report/void-plan'
import type { VoidedAfterReport } from '@/lib/reports/police-report'
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

    // Voided tickets (patches/0108): voided before being reported → left
    // out; voided after → a correction listed on the batch.
    const plan = planPoliceExport(rows)

    // 0. Withheld rows: stamped so they never come back, no file needed.
    if (plan.withheld.length > 0) {
      const { error: wErr } = await admin
        .from('compliance_log')
        .update({ exported_at: generatedAt, exported_format: format, export_outcome: 'withheld_void' })
        .in('id', plan.withheld.map((r) => r.id))
      if (wErr) {
        console.error('[cron:leadsonline-export] withhold stamp failed', t.id, wErr.message)
        skipped.push({ tenant_id: t.id, reason: `withhold_stamp_failed:${wErr.message}` })
        continue
      }
    }
    if (plan.report.length === 0 && plan.notices.length === 0) continue

    const ncicBySlug = await buildNcicBySlug({ supabase: admin, tenantIds: [t.id] })
    const storeId = t.agency_store_id?.trim() || t.id

    const exportResult = dispatch({ format, rows: plan.report, tenantStoreId: storeId, ncicBySlug })
    const voidedAfterReport = await describeNotices(admin, t.id, plan.notices)

    const batchId = randomUUID()
    const covered = [...plan.report, ...plan.notices].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
    const rangeStart = covered[0].occurred_at
    const rangeEnd = covered[covered.length - 1].occurred_at

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
      voided_after_report: voidedAfterReport,
    })
    if (insErr) {
      console.error('[cron:leadsonline-export] batch insert failed', t.id, insErr.message)
      skipped.push({ tenant_id: t.id, reason: `batch_insert_failed:${insErr.message}` })
      continue
    }

    // 2. Stamp the covered rows as exported, each with what became of it.
    for (const [group, outcome] of [
      [plan.report, 'reported'],
      [plan.notices, 'void_notice'],
    ] as const) {
      if (group.length === 0) continue
      const { error: stampErr } = await admin
        .from('compliance_log')
        .update({
          exported_at: generatedAt,
          exported_format: format,
          exported_batch_id: batchId,
          export_outcome: outcome,
        })
        .in('id', group.map((r) => r.id))
      if (stampErr) {
        console.error('[cron:leadsonline-export] mark-exported failed', t.id, stampErr.message)
        skipped.push({ tenant_id: t.id, reason: `mark_exported_failed:${stampErr.message}` })
        // Batch exists; rows will re-export next run (duplicate batch, visible).
      }
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
        withheld_void: plan.withheld.length,
        voided_after_report: voidedAfterReport.length,
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

/**
 * The corrections a batch carries: each ticket voided after an earlier file
 * reported it, with when it was reported and when it was voided.
 */
async function describeNotices(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  notices: ReadonlyArray<{ source_id: string; occurred_at: string }>,
): Promise<VoidedAfterReport[]> {
  if (notices.length === 0) return []
  const loanIds = notices.map((n) => n.source_id)
  const [{ data: loans }, { data: intakes }] = await Promise.all([
    admin.from('loans').select('id, ticket_number').eq('tenant_id', tenantId).in('id', loanIds),
    admin
      .from('compliance_log')
      .select('source_id, exported_at, exported_batch_id')
      .eq('tenant_id', tenantId)
      .eq('event_type', 'pawn_intake')
      .in('source_id', loanIds),
  ])
  return notices.map((n) => {
    const intake = (intakes ?? []).find((i) => i.source_id === n.source_id)
    return {
      loan_id: n.source_id,
      ticket_number: (loans ?? []).find((l) => l.id === n.source_id)?.ticket_number ?? '',
      voided_at: n.occurred_at,
      reported_at: intake?.exported_at ?? null,
      reported_batch_id: intake?.exported_batch_id ?? null,
    }
  })
}

function authorizeCron(req: NextRequest): boolean {
  const auth = req.headers.get('authorization')
  const expected = process.env.CRON_SECRET
  if (!auth || !expected) return false
  return auth === `Bearer ${expected}`
}
