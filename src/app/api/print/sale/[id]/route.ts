/**
 * GET /api/print/sale/[id]
 *
 * Streams a bilingual sale-receipt PDF for the given sale. Render-only —
 * regenerating an already-printed receipt is a normal "reprint" path.
 *
 * Gate stack mirrors /api/print/loan/[id]:
 *   1. getCtx() — must be authenticated.
 *   2. Look up the sale (RLS scopes by tenant; no row = 404).
 *   3. requireRoleInTenant() — staff role at the sale's tenant.
 *   4. Build the PDF via render-sale-receipt.
 *   5. Audit-log the render.
 *   6. Return application/pdf with Content-Disposition: inline.
 */

import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { logAudit } from '@/lib/audit'
import { renderSaleReceiptPdf } from '@/lib/pdf/render-sale-receipt'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const STAFF_SALE_ROLES = [
  'owner',
  'manager',
  'pawn_clerk',
  'chain_admin',
] as const

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: saleId } = await ctx.params
  if (!saleId) {
    return new Response('missing_sale_id', { status: 400 })
  }

  const session = await getCtx()
  if (!session) {
    return new Response('unauthorized', { status: 401 })
  }

  // Resolve the sale to discover its tenant. RLS keeps us in-bounds.
  const { data: sale, error: saleErr } = await session.supabase
    .from('sales')
    .select('id, tenant_id, sale_number')
    .eq('id', saleId)
    .is('deleted_at', null)
    .maybeSingle()

  if (saleErr || !sale) {
    return new Response('not_found', { status: 404 })
  }

  // Role gate at the resolved tenant.
  const { supabase, userId } = await requireRoleInTenant(
    sale.tenant_id,
    STAFF_SALE_ROLES,
  )

  let pdf: { buffer: Buffer; saleNumber: string }
  try {
    pdf = await renderSaleReceiptPdf({
      supabase,
      saleId: sale.id,
      tenantId: sale.tenant_id,
    })
  } catch (err) {
    console.error('[api.print.sale] render failed', err)
    return new Response('render_failed', { status: 500 })
  }

  await logAudit({
    tenantId: sale.tenant_id,
    userId,
    action: 'update',
    tableName: 'sales',
    recordId: sale.id,
    changes: { kind: 'print_render', sale_number: pdf.saleNumber },
  })

  const filename = `sale-receipt-${pdf.saleNumber || sale.id}.pdf`
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
