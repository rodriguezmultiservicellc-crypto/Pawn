/**
 * GET /api/appraisals/[id]/pdf
 *
 * Streams a bilingual appraisal-certificate PDF for the given appraisal.
 * On the FIRST hit while the appraisal is finalized AND not-yet-printed,
 * flips is_printed=true + stamps printed_at. After that, the lock trigger
 * in patches/0014-appraisals.sql freezes core fields. Re-rendering an
 * already-printed appraisal is a normal "reprint" path (no flip, no audit
 * for the lock event).
 *
 * Gate stack:
 *   1. getCtx() — must be authenticated.
 *   2. Look up the appraisal (RLS scopes by tenant; no row = 404).
 *   3. requireRoleInTenant() — staff role at the appraisal's tenant.
 *   4. Build the PDF via renderAppraisalPdf.
 *   5. If the appraisal is finalized AND !is_printed: flip + audit
 *      'appraisal_print'.
 *   6. Audit-log a 'export' event for every render.
 *   7. Return application/pdf with Content-Disposition: inline.
 */

import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { logAudit } from '@/lib/audit'
import { renderAppraisalPdf } from '@/lib/pdf/render-appraisal'
import type { TenantRole } from '@/types/database-aliases'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const STAFF_APPRAISAL_ROLES: ReadonlyArray<TenantRole> = [
  'owner',
  'manager',
  'pawn_clerk',
  'repair_tech',
  'appraiser',
  'chain_admin',
]

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: appraisalId } = await ctx.params
  if (!appraisalId) {
    return new Response('missing_appraisal_id', { status: 400 })
  }

  const session = await getCtx()
  if (!session) {
    return new Response('unauthorized', { status: 401 })
  }

  const { data: appraisal, error: lookupErr } = await session.supabase
    .from('appraisals')
    .select('id, tenant_id, appraisal_number, status, is_printed')
    .eq('id', appraisalId)
    .is('deleted_at', null)
    .maybeSingle()

  if (lookupErr || !appraisal) {
    return new Response('not_found', { status: 404 })
  }

  const { supabase, userId } = await requireRoleInTenant(
    appraisal.tenant_id,
    STAFF_APPRAISAL_ROLES,
  )

  let pdf: { buffer: Buffer; appraisalNumber: string }
  try {
    pdf = await renderAppraisalPdf({
      supabase,
      appraisalId: appraisal.id,
      tenantId: appraisal.tenant_id,
    })
  } catch (err) {
    console.error('[api.appraisals.pdf] render failed', err)
    return new Response('render_failed', { status: 500 })
  }

  // Print-flip on first render of a finalized, unprinted appraisal.
  if (appraisal.status === 'finalized' && !appraisal.is_printed) {
    const { error: flipErr } = await supabase
      .from('appraisals')
      .update({
        is_printed: true,
        printed_at: new Date().toISOString(),
        updated_by: userId,
      })
      .eq('id', appraisal.id)
      .eq('tenant_id', appraisal.tenant_id)
    if (flipErr) {
      // Non-fatal — PDF still streams. Log for diagnostics.
      console.error(
        '[api.appraisals.pdf] is_printed flip failed',
        flipErr.message,
      )
    } else {
      await logAudit({
        tenantId: appraisal.tenant_id,
        userId,
        action: 'appraisal_print',
        tableName: 'appraisals',
        recordId: appraisal.id,
        changes: {
          appraisal_number: pdf.appraisalNumber,
          previous_is_printed: false,
        },
      })
    }
  }

  // Audit every render (including reprints).
  await logAudit({
    tenantId: appraisal.tenant_id,
    userId,
    action: 'export',
    tableName: 'appraisals',
    recordId: appraisal.id,
    changes: { kind: 'pdf_render', appraisal_number: pdf.appraisalNumber },
  })

  const filename = `appraisal-${pdf.appraisalNumber || appraisal.id}.pdf`
  const ab = new ArrayBuffer(pdf.buffer.byteLength)
  new Uint8Array(ab).set(pdf.buffer)
  const body = new Blob([ab], { type: 'application/pdf' })

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
