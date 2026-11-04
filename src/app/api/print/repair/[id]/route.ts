/**
 * GET /api/print/repair/[id] — bilingual repair ticket PDF.
 *
 * Gate stack mirrors /api/print/buy: getCtx() → resolve the ticket's tenant
 * via admin → requireRoleInTenant() → render → audit.
 */

import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit'
import { renderRepairTicketPdf } from '@/lib/pdf/render-repair-ticket'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const STAFF_REPAIR_ROLES = ['owner', 'manager', 'pawn_clerk', 'repair_tech', 'chain_admin'] as const

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params
  if (!id) return new Response('missing_id', { status: 400 })

  const session = await getCtx()
  if (!session) return new Response('unauthorized', { status: 401 })

  const admin = createAdminClient()
  const { data: ticket } = await admin
    .from('repair_tickets')
    .select('id, tenant_id')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (!ticket) return new Response('not_found', { status: 404 })

  const { userId } = await requireRoleInTenant(ticket.tenant_id, STAFF_REPAIR_ROLES)

  let pdf: { buffer: Buffer; ticketNumber: string }
  try {
    pdf = await renderRepairTicketPdf({ admin, ticketId: ticket.id, tenantId: ticket.tenant_id })
  } catch (err) {
    console.error('[api.print.repair] render failed', err)
    return new Response('render_failed', { status: 500 })
  }

  await logAudit({
    tenantId: ticket.tenant_id,
    userId,
    action: 'repair_ticket_print',
    tableName: 'repair_tickets',
    recordId: ticket.id,
    changes: { ticket_number: pdf.ticketNumber },
  })

  const ab = new ArrayBuffer(pdf.buffer.byteLength)
  new Uint8Array(ab).set(pdf.buffer)
  return new Response(new Blob([ab], { type: 'application/pdf' }), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="repair-ticket-${pdf.ticketNumber || ticket.id}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
