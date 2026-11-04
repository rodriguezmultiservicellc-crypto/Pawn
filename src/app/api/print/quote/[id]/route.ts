/**
 * GET /api/print/quote/[id] — customer-facing custom quote PDF.
 * Gate stack mirrors /api/print/buy.
 */

import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit'
import { renderCustomQuotePdf } from '@/lib/pdf/render-custom-quote'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const STAFF_REPAIR_ROLES = ['owner', 'manager', 'pawn_clerk', 'repair_tech', 'chain_admin'] as const

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params
  if (!id) return new Response('missing_id', { status: 400 })

  const session = await getCtx()
  if (!session) return new Response('unauthorized', { status: 401 })

  const admin = createAdminClient()
  const { data: quote } = await admin
    .from('custom_quotes')
    .select('id, tenant_id')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (!quote) return new Response('not_found', { status: 404 })

  const { userId } = await requireRoleInTenant(quote.tenant_id, STAFF_REPAIR_ROLES)

  let pdf: { buffer: Buffer; quoteNumber: string }
  try {
    pdf = await renderCustomQuotePdf({ admin, quoteId: quote.id, tenantId: quote.tenant_id })
  } catch (err) {
    console.error('[api.print.quote] render failed', err)
    return new Response('render_failed', { status: 500 })
  }

  await logAudit({
    tenantId: quote.tenant_id,
    userId,
    action: 'custom_quote_print',
    tableName: 'custom_quotes',
    recordId: quote.id,
    changes: { quote_number: pdf.quoteNumber },
  })

  const ab = new ArrayBuffer(pdf.buffer.byteLength)
  new Uint8Array(ab).set(pdf.buffer)
  return new Response(new Blob([ab], { type: 'application/pdf' }), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="quote-${pdf.quoteNumber || quote.id}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
