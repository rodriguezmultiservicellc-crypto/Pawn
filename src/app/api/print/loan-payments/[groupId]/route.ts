/**
 * GET /api/print/loan-payments/[groupId]?format=letter|thermal
 *
 * The ONE receipt of several pawn tickets paid together (loan_events.
 * payment_group_id, patches/0112), as a printable HTML page — the same
 * hidden-frame print as a single payment receipt
 * (/api/print/loan/[id]/payment/[eventId]). Printing again is the reprint.
 *
 * Gate stack mirrors the single receipt:
 *   1. getCtx() — must be authenticated.
 *   2. Find the group's payments (RLS scopes by tenant; none = 404).
 *   3. requireRoleInTenant() — staff role at that tenant.
 *   4. Build the page.
 *   5. Audit-log the print against each ticket.
 */

import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { logAudit } from '@/lib/audit'
import { loadPaymentGroupReceipt } from '@/lib/pawn/payment-receipt-data'
import { paymentGroupReceiptHtml } from '@/lib/pawn/payment-receipt'
import { isReceiptFormat } from '@/lib/pos/receipt-format'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const STAFF_LOAN_ROLES = ['owner', 'manager', 'pawn_clerk', 'chain_admin'] as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(
  req: Request,
  ctx: { params: Promise<{ groupId: string }> },
): Promise<Response> {
  const { groupId } = await ctx.params
  if (!UUID.test(groupId)) return new Response('bad_id', { status: 400 })

  const format = new URL(req.url).searchParams.get('format')
  if (!isReceiptFormat(format)) return new Response('bad_format', { status: 400 })

  const session = await getCtx()
  if (!session) return new Response('unauthorized', { status: 401 })

  const { data: first, error: firstErr } = await session.supabase
    .from('loan_events')
    .select('tenant_id')
    .eq('payment_group_id', groupId)
    .limit(1)
    .maybeSingle()
  if (firstErr || !first) return new Response('not_found', { status: 404 })

  const tenantId = first.tenant_id
  const { supabase, userId } = await requireRoleInTenant(tenantId, STAFF_LOAN_ROLES)

  let html: string
  let loanIds: string[]
  let ticketNumbers: string[]
  try {
    const found = await loadPaymentGroupReceipt({ supabase, tenantId, groupId })
    if (!found) return new Response('not_found', { status: 404 })
    html = paymentGroupReceiptHtml(found.doc, format)
    loanIds = found.loanIds
    ticketNumbers = found.doc.tickets.map((t) => t.ticket_number)
  } catch (err) {
    console.error('[api.print.loan-payments] render failed', err)
    return new Response('render_failed', { status: 500 })
  }

  for (const loanId of loanIds) {
    await logAudit({
      tenantId,
      userId,
      action: 'update',
      tableName: 'loans',
      recordId: loanId,
      changes: {
        kind: 'print_render',
        document: 'payment_group_receipt',
        payment_group_id: groupId,
        format,
        ticket_numbers: ticketNumbers,
      },
    })
  }

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' },
  })
}
