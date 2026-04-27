/**
 * GET /api/print/loan/[id]
 *
 * Streams a bilingual pawn-ticket PDF for the given loan. Render-only —
 * does NOT flip is_printed (that's the user-facing button's job via
 * printTicketAction). Re-rendering an already-printed ticket is a
 * normal "reprint" path.
 *
 * Gate stack:
 *   1. getCtx() — must be authenticated.
 *   2. Look up the loan (RLS scopes by tenant; no row = 404).
 *   3. requireRoleInTenant() — staff role at the loan's tenant.
 *   4. Build the PDF via render-loan-ticket.
 *   5. Audit-log a 'print' event.
 *   6. Return application/pdf with Content-Disposition: inline.
 */

import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { logAudit } from '@/lib/audit'
import { renderLoanTicketPdf } from '@/lib/pdf/render-loan-ticket'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const STAFF_LOAN_ROLES = [
  'owner',
  'manager',
  'pawn_clerk',
  'chain_admin',
] as const

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: loanId } = await ctx.params
  if (!loanId) {
    return new Response('missing_loan_id', { status: 400 })
  }

  const session = await getCtx()
  if (!session) {
    return new Response('unauthorized', { status: 401 })
  }

  // Resolve the loan to discover its tenant. RLS keeps us in-bounds.
  const { data: loan, error: loanErr } = await session.supabase
    .from('loans')
    .select('id, tenant_id, ticket_number')
    .eq('id', loanId)
    .is('deleted_at', null)
    .maybeSingle()

  if (loanErr || !loan) {
    return new Response('not_found', { status: 404 })
  }

  // Role gate at the resolved tenant.
  const { supabase, userId } = await requireRoleInTenant(
    loan.tenant_id,
    STAFF_LOAN_ROLES,
  )

  let pdf: { buffer: Buffer; ticketNumber: string }
  try {
    pdf = await renderLoanTicketPdf({
      supabase,
      loanId: loan.id,
      tenantId: loan.tenant_id,
    })
  } catch (err) {
    console.error('[api.print.loan] render failed', err)
    return new Response('render_failed', { status: 500 })
  }

  // Audit-log the render. Differentiated from the `update` event written
  // by printTicketAction — this one captures every render, including
  // reprints, while the action-side event captures the immutability lock.
  await logAudit({
    tenantId: loan.tenant_id,
    userId,
    action: 'update',
    tableName: 'loans',
    recordId: loan.id,
    changes: { kind: 'print_render', ticket_number: pdf.ticketNumber },
  })

  const filename = `pawn-ticket-${pdf.ticketNumber || loan.id}.pdf`
  // Copy the Buffer into a freshly-allocated ArrayBuffer so the Blob
  // constructor sees a plain ArrayBuffer (TS otherwise widens
  // Buffer.buffer to ArrayBuffer | SharedArrayBuffer).
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
