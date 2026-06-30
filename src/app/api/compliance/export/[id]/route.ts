/**
 * GET /api/compliance/export/[id]
 *
 * Download a frozen daily police-report export batch (the exact CSV the
 * cron generated) by its compliance_export_batches id.
 *
 * Access is gated by RLS: the user-scoped client only returns the row when
 * the caller is staff of the owning tenant
 * (compliance_export_batches_staff_read). A non-member gets a 404, not a
 * 403, so the endpoint doesn't confirm a batch id exists to outsiders.
 *
 * The re-download is audit-logged (these are regulated police records).
 */

import { getCtx } from '@/lib/supabase/ctx'
import { csvResponse } from '@/lib/reports/http'
import { logAudit } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getCtx()
  if (!ctx) return new Response('unauthorized', { status: 401 })
  if (!ctx.tenantId) return new Response('no_tenant', { status: 403 })

  const { id } = await params

  // RLS (compliance_export_batches_staff_read) scopes the read to the
  // caller's tenant — a non-member gets no row (→ 404 below).
  const { data: batch, error } = await ctx.supabase
    .from('compliance_export_batches')
    .select('id, tenant_id, format, filename, csv_body')
    .eq('id', id)
    .maybeSingle()

  if (error) return new Response('error', { status: 502 })
  if (!batch) return new Response('not_found', { status: 404 })

  await logAudit({
    tenantId: batch.tenant_id,
    userId: ctx.userId,
    action: 'export',
    tableName: 'compliance_export_batches',
    recordId: batch.id,
    changes: { report: 'police-report', format: batch.format, kind: 'batch_download' },
  })

  return csvResponse(batch.filename, batch.csv_body)
}
