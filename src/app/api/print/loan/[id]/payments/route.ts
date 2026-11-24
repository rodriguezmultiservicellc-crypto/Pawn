/**
 * GET /api/print/loan/[id]/payments
 *
 * The ticket's payment history as a printable HTML page — the page handed to
 * a customer who says "I already paid": one row per stretch of time with the
 * payment that paid for it, and the stretch not paid yet. Letter size,
 * English and Spanish on the same sheet. The ticket page loads it into a
 * hidden frame and calls print() (PaymentHistoryPanel).
 *
 * Gate stack mirrors /api/print/loan/[id]:
 *   1. getCtx() — must be authenticated.
 *   2. Look up the loan (RLS scopes by tenant; no row = 404).
 *   3. requireRoleInTenant() — staff role at the loan's tenant.
 *   4. Build the page.
 *   5. Audit-log the print.
 */

import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { logAudit } from '@/lib/audit'
import { loadPaymentHistory } from '@/lib/pawn/payment-history-data'
import { paymentHistoryHtml } from '@/lib/pawn/payment-history'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const STAFF_LOAN_ROLES = ['owner', 'manager', 'pawn_clerk', 'chain_admin'] as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: loanId } = await ctx.params
  if (!UUID.test(loanId)) return new Response('bad_id', { status: 400 })

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
    const doc = await loadPaymentHistory({ supabase, tenantId: loan.tenant_id, loanId: loan.id })
    if (!doc) return new Response('not_found', { status: 404 })
    html = paymentHistoryHtml(doc)
    ticketNumber = doc.ticket_number
  } catch (err) {
    console.error('[api.print.loan.payments] render failed', err)
    return new Response('render_failed', { status: 500 })
  }

  await logAudit({
    tenantId: loan.tenant_id,
    userId,
    action: 'update',
    tableName: 'loans',
    recordId: loan.id,
    changes: { kind: 'print_render', document: 'payment_history', ticket_number: ticketNumber },
  })

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' },
  })
}
