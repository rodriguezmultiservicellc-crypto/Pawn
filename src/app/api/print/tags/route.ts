/**
 * GET /api/print/tags — item tags as PDF (any printer) or ZPL (Zebra).
 *
 *   ?kind=inventory&ids=<uuid>,<uuid>…   up to 200 items, printed in order
 *   ?kind=collateral&loan=<uuid>         one tag per pledged item (has_pawn)
 *   ?kind=repair&ticket=<uuid>           one envelope label (has_repair)
 *   &format=pdf|zpl                      default pdf
 *   &template=<label_templates.id>       default: the tenant's default
 *   &test=1                              test print: does not stamp tag_printed_at
 *
 * Gate: active tenant from getCtx(), role per kind, module flag per kind.
 * Every query is tenant-filtered. Printing inventory tags stamps
 * inventory_items.tag_printed_at (the "Needs tag" filter) and writes one
 * audit row per print run. Layout warnings travel in X-Tag-Warnings.
 */

import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { logAudit } from '@/lib/audit'
import {
  loadCollateralTags,
  loadInventoryTags,
  loadRepairTags,
  loadTagShopContext,
  loadTagTemplates,
} from '@/lib/labels/load'
import { pickTemplate, TAG_KINDS, type TagKind } from '@/lib/labels/templates'
import type { TagContent } from '@/lib/labels/tag-content'
import type { TagWarning } from '@/lib/labels/layout'
import { renderZplBatch } from '@/lib/labels/zpl'
import { renderItemTagsPdf } from '@/lib/pdf/render-item-tags'
import type { TenantRole } from '@/types/database-aliases'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ROLES: Record<TagKind, readonly TenantRole[]> = {
  inventory: ['owner', 'chain_admin', 'manager', 'pawn_clerk'],
  collateral: ['owner', 'chain_admin', 'manager', 'pawn_clerk'],
  repair: ['owner', 'chain_admin', 'manager', 'pawn_clerk', 'repair_tech'],
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const kind = url.searchParams.get('kind') as TagKind | null
  if (!kind || !(TAG_KINDS as readonly string[]).includes(kind)) {
    return new Response('bad_kind', { status: 400 })
  }
  const format = url.searchParams.get('format') === 'zpl' ? 'zpl' : 'pdf'
  const templateId = url.searchParams.get('template')
  const isTest = url.searchParams.get('test') === '1'

  const session = await getCtx()
  if (!session) return new Response('unauthorized', { status: 401 })
  if (!session.tenantId) return new Response('no_tenant', { status: 403 })
  const tenantId = session.tenantId

  const { supabase, userId } = await requireRoleInTenant(tenantId, ROLES[kind])
  const shop = await loadTagShopContext(supabase, tenantId)
  if (kind === 'collateral' && !shop.hasPawn) return new Response('module_off', { status: 403 })
  if (kind === 'repair' && !shop.hasRepair) return new Response('module_off', { status: 403 })

  const template = pickTemplate(await loadTagTemplates(supabase, tenantId), kind, templateId)

  let contents: TagContent[] = []
  let itemIds: string[] = []
  let recordId: string
  let tableName: string
  let fileStem: string

  try {
    if (kind === 'inventory') {
      const ids = (url.searchParams.get('ids') ?? '').split(',').map((s) => s.trim()).filter((s) => UUID.test(s))
      if (ids.length === 0) return new Response('missing_ids', { status: 400 })
      const r = await loadInventoryTags({ supabase, tenantId, ids, template, shopName: shop.shopName, costCodeWord: shop.costCodeWord })
      contents = r.contents
      itemIds = r.itemIds
      recordId = itemIds[0] ?? ids[0]
      tableName = 'inventory_items'
      fileStem = itemIds.length === 1 ? `tag-${contents[0]?.code ?? 'item'}` : `tags-${itemIds.length}`
    } else if (kind === 'collateral') {
      const loanId = url.searchParams.get('loan') ?? ''
      if (!UUID.test(loanId)) return new Response('missing_loan', { status: 400 })
      const r = await loadCollateralTags({ supabase, tenantId, loanId, template })
      contents = r.contents
      recordId = loanId
      tableName = 'loans'
      fileStem = `collateral-${r.ticketNumber ?? loanId}`
    } else {
      const ticketId = url.searchParams.get('ticket') ?? ''
      if (!UUID.test(ticketId)) return new Response('missing_ticket', { status: 400 })
      const r = await loadRepairTags({ supabase, tenantId, ticketId, template })
      contents = r.contents
      recordId = ticketId
      tableName = 'repair_tickets'
      fileStem = `repair-${r.ticketNumber ?? ticketId}`
    }
  } catch (err) {
    console.error('[api.print.tags] load failed', err)
    return new Response('load_failed', { status: 500 })
  }

  if (contents.length === 0) return new Response('not_found', { status: 404 })

  let body: Blob
  let warnings: TagWarning[]
  try {
    if (format === 'zpl') {
      const r = renderZplBatch(template, contents)
      warnings = r.warnings
      body = new Blob([r.zpl], { type: 'text/plain; charset=utf-8' })
    } else {
      const r = await renderItemTagsPdf({ template, contents, title: fileStem })
      warnings = r.warnings
      const ab = new ArrayBuffer(r.buffer.byteLength)
      new Uint8Array(ab).set(r.buffer)
      body = new Blob([ab], { type: 'application/pdf' })
    }
  } catch (err) {
    console.error('[api.print.tags] render failed', err)
    return new Response('render_failed', { status: 500 })
  }

  if (kind === 'inventory' && itemIds.length > 0 && !isTest) {
    const { error } = await supabase
      .from('inventory_items')
      .update({ tag_printed_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .in('id', itemIds)
    if (error) console.error('[api.print.tags] tag_printed_at update failed', error.message)
  }

  await logAudit({
    tenantId,
    userId,
    action: 'tag_print',
    tableName,
    recordId,
    changes: {
      kind,
      format,
      test: isTest,
      count: contents.length,
      template: template.id ?? `builtin:${template.name}`,
      codes: contents.map((c) => c.code).slice(0, 200),
      warnings,
    },
  })

  const ext = format === 'zpl' ? 'zpl' : 'pdf'
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': format === 'zpl' ? 'text/plain; charset=utf-8' : 'application/pdf',
      'Content-Disposition': `${format === 'zpl' ? 'attachment' : 'inline'}; filename="${fileStem}.${ext}"`,
      'Cache-Control': 'private, no-store',
      'X-Tag-Warnings': warnings.join(','),
    },
  })
}
