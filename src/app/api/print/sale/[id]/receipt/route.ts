/**
 * GET /api/print/sale/[id]/receipt?format=letter|thermal
 *
 * The sale receipt as a printable HTML page — no PDF. The POS fetches it,
 * loads it into a hidden frame and calls print(), so the receipt goes to the
 * printer without a PDF viewer or a new tab (PrintReceiptDialog).
 *
 * Gate stack mirrors /api/print/sale/[id]:
 *   1. getCtx() — must be authenticated.
 *   2. Look up the sale (RLS scopes by tenant; no row = 404).
 *   3. requireRoleInTenant() — staff role at the sale's tenant.
 *   4. Build the page from loadSaleReceiptData.
 *   5. Audit-log the print with its format.
 */

import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { logAudit } from '@/lib/audit'
import { loadSaleReceiptData } from '@/lib/pos/receipt-data'
import { saleReceiptHtml } from '@/lib/pos/receipt-html'
import { isReceiptFormat } from '@/lib/pos/receipt-format'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const STAFF_SALE_ROLES = ['owner', 'manager', 'pawn_clerk', 'chain_admin'] as const

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: saleId } = await ctx.params
  if (!saleId) return new Response('missing_sale_id', { status: 400 })

  const format = new URL(req.url).searchParams.get('format')
  if (!isReceiptFormat(format)) return new Response('bad_format', { status: 400 })

  const session = await getCtx()
  if (!session) return new Response('unauthorized', { status: 401 })

  const { data: sale, error: saleErr } = await session.supabase
    .from('sales')
    .select('id, tenant_id, sale_number')
    .eq('id', saleId)
    .is('deleted_at', null)
    .maybeSingle()
  if (saleErr || !sale) return new Response('not_found', { status: 404 })

  const { supabase, userId } = await requireRoleInTenant(sale.tenant_id, STAFF_SALE_ROLES)

  let html: string
  try {
    const data = await loadSaleReceiptData({ supabase, saleId: sale.id, tenantId: sale.tenant_id })
    html = saleReceiptHtml(data, format)
  } catch (err) {
    console.error('[api.print.sale.receipt] render failed', err)
    return new Response('render_failed', { status: 500 })
  }

  await logAudit({
    tenantId: sale.tenant_id,
    userId,
    action: 'update',
    tableName: 'sales',
    recordId: sale.id,
    changes: { kind: 'print_render', format, sale_number: sale.sale_number },
  })

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
