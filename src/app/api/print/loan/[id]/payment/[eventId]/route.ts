/**
 * GET /api/print/loan/[id]/payment/[eventId]?format=letter|thermal
 *
 * The receipt of ONE payment on a pawn ticket as a printable HTML page — no
 * PDF. The loan page loads it into a hidden frame and calls print()
 * (ReceiptFormatDialog), the same way the POS prints a sale receipt.
 * Printing an old payment again is the normal "reprint" path: nothing is
 * written except the audit row.
 *
 * Gate stack mirrors /api/print/loan/[id]:
 *   1. getCtx() — must be authenticated.
 *   2. Look up the loan (RLS scopes by tenant; no row = 404).
 *   3. requireRoleInTenant() — staff role at the loan's tenant.
 *   4. Build the page; 404 when the event is not a payment of that loan.
 *   5. Audit-log the print with its format.
 */

import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { logAudit } from '@/lib/audit'
import { loadPaymentReceipt } from '@/lib/pawn/payment-receipt-data'
import { paymentReceiptHtml } from '@/lib/pawn/payment-receipt'
import { isReceiptFormat } from '@/lib/pos/receipt-format'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const STAFF_LOAN_ROLES = ['owner', 'manager', 'pawn_clerk', 'chain_admin'] as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; eventId: string }> },
): Promise<Response> {
  const { id: loanId, eventId } = await ctx.params
  if (!UUID.test(loanId) || !UUID.test(eventId)) return new Response('bad_id', { status: 400 })

  const format = new URL(req.url).searchParams.get('format')
  if (!isReceiptFormat(format)) return new Response('bad_format', { status: 400 })

  const session = await getCtx()
  if (!session) return new Response('unauthorized', { status: 401 })

  const { data: loan, error: loanErr } = await session.supabase
    .from('loans')
    .select('id, tenant_id')
    .eq('id', loanId)
    .is('deleted_at', null)
    .maybeSingle()
  if (loanErr || !loan) return new Response('not_found', { status: 404 })

  const { supabase, userId } = await requireRoleInTenant(loan.tenant_id, STAFF_LOAN_ROLES)

  let html: string
  let ticketNumber: string
  try {
    const doc = await loadPaymentReceipt({ supabase, tenantId: loan.tenant_id, loanId: loan.id, eventId })
    if (!doc) return new Response('not_found', { status: 404 })
    html = paymentReceiptHtml(doc, format)
    ticketNumber = doc.ticket_number
  } catch (err) {
    console.error('[api.print.loan.payment] render failed', err)
    return new Response('render_failed', { status: 500 })
  }

  await logAudit({
    tenantId: loan.tenant_id,
    userId,
    action: 'update',
    tableName: 'loans',
    recordId: loan.id,
    changes: { kind: 'print_render', document: 'payment_receipt', event_id: eventId, format, ticket_number: ticketNumber },
  })

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' },
  })
}
