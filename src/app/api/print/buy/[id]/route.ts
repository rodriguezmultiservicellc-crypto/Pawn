/**
 * GET /api/print/buy/[id]
 *
 * Streams a bilingual buy-outright receipt PDF. The path param is the
 * anchor inventory_item_id (same convention as /buy/[id] page) — we
 * resolve the compliance_log row from there.
 *
 * Gate stack:
 *   1. getCtx() — must be authenticated.
 *   2. Resolve the inventory item to discover its tenant (via admin —
 *      keeps tenant lookup uniform with the receipt page itself).
 *   3. requireRoleInTenant() — staff role at the resolved tenant.
 *   4. Render the PDF.
 *   5. Audit-log the render.
 */

import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit'
import { renderBuyReceiptPdf } from '@/lib/pdf/render-buy-receipt'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const STAFF_BUY_ROLES = [
  'owner',
  'manager',
  'pawn_clerk',
  'chain_admin',
] as const

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: anchorItemId } = await ctx.params
  if (!anchorItemId) {
    return new Response('missing_item_id', { status: 400 })
  }

  const session = await getCtx()
  if (!session) {
    return new Response('unauthorized', { status: 401 })
  }

  // Resolve the inventory item → tenant. Use admin because RLS on
  // inventory_items already restricts staff to their tenant; we just
  // need to know which tenant to gate against.
  const admin = createAdminClient()
  const { data: item, error: itemErr } = await admin
    .from('inventory_items')
    .select('id, tenant_id')
    .eq('id', anchorItemId)
    .is('deleted_at', null)
    .maybeSingle()

  if (itemErr || !item) {
    return new Response('not_found', { status: 404 })
  }

  // Role gate at the resolved tenant.
  const { userId } = await requireRoleInTenant(item.tenant_id, STAFF_BUY_ROLES)

  let pdf: { buffer: Buffer; receiptNumber: string }
  try {
    pdf = await renderBuyReceiptPdf({
      admin,
      anchorItemId: item.id,
      tenantId: item.tenant_id,
    })
  } catch (err) {
    console.error('[api.print.buy] render failed', err)
    return new Response('render_failed', { status: 500 })
  }

  await logAudit({
    tenantId: item.tenant_id,
    userId,
    action: 'update',
    tableName: 'compliance_log',
    recordId: item.id,
    changes: { kind: 'print_render', receipt_number: pdf.receiptNumber },
  })

  const filename = `buy-receipt-${pdf.receiptNumber || item.id}.pdf`
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
