/**
 * Cron — daily police-report (LeadsOnline) file.
 *
 * MAKES the file, never SENDS it: nothing here uploads to LeadsOnline (Eddy,
 * 2026-11-24: the shop still reports from xPawn; nothing uploads yet).
 *
 * For every active pawn tenant with a configured police_report_format:
 *   1. Select the tenant's UNEXPORTED compliance_log rows (pawn_intake,
 *      buy_outright, pawn_void).
 *   2. Plan them (void-plan.ts): ordinary tickets go in; a ticket voided
 *      before it was reported goes in once, voided; a ticket voided after
 *      goes in again, voided (from its intake row).
 *   3. Build the LeadsOnline XML (formats/fl-leadsonline-xml.ts — the format
 *      xPawn sent), with the tenant's NCIC codes.
 *   4. INSERT a frozen compliance_export_batches row holding the exact file
 *      (csv_body keeps its old name; it holds the XML now).
 *   5. Stamp the covered rows: exported_at / exported_format /
 *      exported_batch_id / export_outcome (bookkeeping columns the
 *      immutability trigger allows).
 *
 * Ordering is batch-INSERT-first, then stamp: a stamp failure leaves the
 * rows unexported (they go again next run, a duplicate batch the operator
 * can spot) rather than marking transactions reported with no file —
 * under-reporting is the worse failure. LeadsOnline took identical resends
 * from xPawn (four tickets sent twice).
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}` only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { getIntakeRows, getUnexportedPoliceReportRows, type VoidedAfterReport } from '@/lib/reports/police-report'
import { buildNcicBySlug } from '@/lib/compliance/ncic'
import { dispatch, storeFromTenant } from '@/lib/compliance/police-report'
import { planPoliceExport } from '@/lib/compliance/police-report/void-plan'
import type { LeadsOnlineTicket } from '@/lib/compliance/police-report/formats/fl-leadsonline-xml'
import type { PoliceReportFormat } from '@/types/database-aliases'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SUPPORTED_FORMATS: PoliceReportFormat[] = ['fl_leadsonline']

type TenantRow = {
  id: string
  name: string
  dba: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  phone: string | null
  timezone: string | null
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
    .select('id, name, dba, address, city, state, zip, phone, timezone, agency_store_id, police_report_format')
    .eq('has_pawn', true)
    .eq('is_active', true)

  if (tenantErr) {
    return NextResponse.json({ ok: false, error: tenantErr.message }, { status: 502 })
  }

  const now = new Date()
  const generatedAt = now.toISOString()
  const generated: Array<{ tenant_id: string; batch_id: string; transactions: number; rows: number }> = []
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
      skipped.push({ tenant_id: t.id, reason: err instanceof Error ? err.message : 'query_failed' })
      continue
    }
    if (rows.length === 0) continue
    const plan = planPoliceExport(rows)

    let resendIntakes
    try {
      resendIntakes = await getIntakeRows({
        supabase: admin,
        tenantId: t.id,
        sourceIds: plan.resendVoided.map((r) => r.source_id),
      })
    } catch (err) {
      skipped.push({ tenant_id: t.id, reason: err instanceof Error ? err.message : 'query_failed' })
      continue
    }

    const tickets: LeadsOnlineTicket[] = [
      ...plan.send,
      ...resendIntakes.map((row) => ({ row, voided: true })),
    ]
    const timeZone = t.timezone || 'America/New_York'
    const ncicBySlug = await buildNcicBySlug({ supabase: admin, tenantIds: [t.id] })
    const exportResult = dispatch({
      format,
      tickets,
      store: storeFromTenant(t),
      timeZone,
      at: now,
      ncicBySlug,
    })

    const voidedAfterReport: VoidedAfterReport[] = plan.resendVoided.map((v) => {
      const intake = resendIntakes.find((i) => i.source_id === v.source_id)
      return {
        loan_id: v.source_id,
        ticket_number: v.reference_number ?? '',
        voided_at: v.occurred_at,
        reported_at: intake?.exported_at ?? null,
        reported_batch_id: intake?.exported_batch_id ?? null,
        resent_at: generatedAt,
      }
    })

    const batchId = randomUUID()
    const covered = [...rows].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
    const rangeStart = covered[0].occurred_at
    const rangeEnd = covered[covered.length - 1].occurred_at

    // 1. Persist the frozen file first (never lose it).
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

    // 2. Stamp every covered row with what became of it.
    for (const outcome of ['reported', 'reported_void', 'void_notice'] as const) {
      const ids = plan.stamps.filter((st) => st.outcome === outcome).map((st) => st.id)
      if (ids.length === 0) continue
      const { error: stampErr } = await admin
        .from('compliance_log')
        .update({ exported_at: generatedAt, exported_format: format, exported_batch_id: batchId, export_outcome: outcome })
        .in('id', ids)
      if (stampErr) {
        console.error('[cron:leadsonline-export] mark-exported failed', t.id, stampErr.message)
        skipped.push({ tenant_id: t.id, reason: `mark_exported_failed:${stampErr.message}` })
        // Batch exists; rows will go again next run (duplicate batch, visible).
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
        tickets: exportResult.transactionCount,
        items: exportResult.rowCount,
        voided: tickets.filter((x) => x.voided).length,
        resent_voided: voidedAfterReport.length,
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

  return NextResponse.json({ ok: true, generatedAt, generated: generated.length, batches: generated, skipped })
}

function authorizeCron(req: NextRequest): boolean {
  const auth = req.headers.get('authorization')
  const expected = process.env.CRON_SECRET
  if (!auth || !expected) return false
  return auth === `Bearer ${expected}`
}
