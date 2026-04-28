/**
 * GET /api/reports/1099/[year]/csv
 *
 * Streams the 1099-MISC year-end candidate CSV for the active tenant +
 * tax year. Reads from compliance_log via buildForm1099Report (Rule 15
 * — buy-outright transactions are the source of truth, same query path
 * as the police report).
 *
 * Role gate: owner / manager / chain_admin (matches the page-level gate).
 *
 * Query params:
 *   threshold  optional, defaults to $600 — IRS reporting threshold.
 */

import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import {
  buildForm1099Report,
  FORM_1099_DEFAULT_THRESHOLD,
  type Form1099Candidate,
} from '@/lib/reports/form-1099'
import { csvResponse, rowsToCsv, type CsvColumn } from '@/lib/reports/http'
import { logAudit } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const COLUMNS: ReadonlyArray<CsvColumn<Form1099Candidate>> = [
  { header: 'customer_id', value: (r) => r.customer_id ?? '' },
  { header: 'customer_name', value: 'customer_name' },
  { header: 'address', value: 'address' },
  { header: 'id_type', value: (r) => r.id_type ?? '' },
  { header: 'id_number', value: (r) => r.id_number ?? '' },
  { header: 'date_of_birth', value: (r) => r.date_of_birth ?? '' },
  { header: 'recipient_tin', value: () => '(collect via W-9)' },
  { header: 'total_paid', value: (r) => r.total_paid.toFixed(2) },
  { header: 'transaction_count', value: 'transaction_count' },
  { header: 'first_payment_date', value: 'first_payment_date' },
  { header: 'last_payment_date', value: 'last_payment_date' },
  { header: 'current_phone', value: (r) => r.current_phone ?? '' },
  { header: 'current_email', value: (r) => r.current_email ?? '' },
  {
    header: 'customer_active',
    value: (r) => (r.customer_active ? 'true' : 'false'),
  },
]

export async function GET(
  req: Request,
  { params }: { params: Promise<{ year: string }> },
) {
  const ctx = await getCtx()
  if (!ctx) return new Response('unauthorized', { status: 401 })
  if (!ctx.tenantId) return new Response('no_tenant', { status: 403 })

  // Role gate (matches /staff/reports/1099 page).
  await requireRoleInTenant(ctx.tenantId, ['owner', 'manager', 'chain_admin'])

  const { year: yearRaw } = await params
  const taxYear = parseInt(yearRaw, 10)
  if (!Number.isInteger(taxYear) || taxYear < 2000 || taxYear > 2100) {
    return new Response(`invalid_year:${yearRaw}`, { status: 400 })
  }

  const url = new URL(req.url)
  const thresholdRaw = url.searchParams.get('threshold')
  const thresholdParsed = thresholdRaw == null ? NaN : parseInt(thresholdRaw, 10)
  const threshold =
    Number.isFinite(thresholdParsed) && thresholdParsed >= 0
      ? thresholdParsed
      : FORM_1099_DEFAULT_THRESHOLD

  const report = await buildForm1099Report({
    tenantId: ctx.tenantId,
    taxYear,
    threshold,
  })

  await logAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: 'export',
    tableName: 'compliance_log',
    recordId: ctx.tenantId,
    changes: {
      report: '1099-misc',
      format: 'csv',
      tax_year: taxYear,
      threshold,
      candidate_count: report.totalCandidatesAboveThreshold,
      total_paid_above_threshold: report.candidates.reduce(
        (acc, c) => acc + c.total_paid,
        0,
      ),
    },
  })

  return csvResponse(
    `1099-misc-${taxYear}.csv`,
    rowsToCsv(report.candidates, COLUMNS),
  )
}
