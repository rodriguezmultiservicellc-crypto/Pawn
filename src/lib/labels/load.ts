/**
 * Server-side loaders for tag printing. Callers gate first (guards), then
 * pass the user-scoped client; every query is also filtered by tenant_id.
 */

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import {
  buildCollateralTag,
  buildInventoryTag,
  buildRepairTag,
  type StoneSummaryRow,
  type TagContent,
} from './tag-content'
import { normalizeFields, type TagDpi, type TagKind, type TagTemplate } from './templates'

type Db = SupabaseClient<Database>

type TemplateRow = Database['public']['Tables']['label_templates']['Row']

export function templateFromRow(r: TemplateRow): TagTemplate {
  const kind = r.kind as TagKind
  return {
    id: r.id,
    name: r.name,
    kind,
    width_in: Number(r.width_in),
    height_in: Number(r.height_in),
    layout: r.layout === 'split' ? 'split' : 'single',
    gap_in: Number(r.gap_in),
    dpi: r.dpi as TagDpi,
    barcode_payload: r.barcode_payload === 'number' ? 'number' : 'code',
    fields: normalizeFields(kind, r.fields),
    is_default: r.is_default,
  }
}

export async function loadTagTemplates(supabase: Db, tenantId: string): Promise<TagTemplate[]> {
  const { data, error } = await supabase
    .from('label_templates')
    .select('*')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('kind')
    .order('name')
  if (error) throw new Error(`label_templates_lookup_failed: ${error.message}`)
  return (data ?? []).map(templateFromRow)
}

export async function loadTagShopContext(
  supabase: Db,
  tenantId: string,
): Promise<{ shopName: string | null; costCodeWord: string | null; hasPawn: boolean; hasRepair: boolean }> {
  const [{ data: tenant }, { data: settings }] = await Promise.all([
    supabase.from('tenants').select('name, dba, has_pawn, has_repair').eq('id', tenantId).maybeSingle(),
    supabase.from('settings').select('tag_cost_code').eq('tenant_id', tenantId).maybeSingle(),
  ])
  return {
    shopName: tenant?.dba || tenant?.name || null,
    costCodeWord: settings?.tag_cost_code ?? null,
    hasPawn: tenant?.has_pawn === true,
    hasRepair: tenant?.has_repair === true,
  }
}

export const MAX_TAGS_PER_PRINT = 200

/** Inventory tags in the order the ids were given. Unknown ids are skipped. */
export async function loadInventoryTags(args: {
  supabase: Db
  tenantId: string
  ids: string[]
  template: TagTemplate
  shopName: string | null
  costCodeWord: string | null
}): Promise<{ contents: TagContent[]; itemIds: string[] }> {
  const ids = [...new Set(args.ids)].slice(0, MAX_TAGS_PER_PRINT)
  if (ids.length === 0) return { contents: [], itemIds: [] }
  const { data: items, error } = await args.supabase
    .from('inventory_items')
    .select('id, sku, sku_number, list_price, metal, karat, weight_grams, description, cost_basis')
    .eq('tenant_id', args.tenantId)
    .in('id', ids)
    .is('deleted_at', null)
  if (error) throw new Error(`inventory_lookup_failed: ${error.message}`)

  const { data: stones } = await args.supabase
    .from('inventory_item_stones')
    .select('item_id, count, carat, is_total_carat')
    .eq('tenant_id', args.tenantId)
    .in('item_id', ids)
    .is('deleted_at', null)
  const stonesByItem = new Map<string, StoneSummaryRow[]>()
  for (const s of stones ?? []) {
    const list = stonesByItem.get(s.item_id) ?? []
    list.push(s)
    stonesByItem.set(s.item_id, list)
  }

  const byId = new Map((items ?? []).map((i) => [i.id, i]))
  const contents: TagContent[] = []
  const itemIds: string[] = []
  for (const id of ids) {
    const item = byId.get(id)
    if (!item) continue
    contents.push(
      buildInventoryTag({
        item: { ...item, stones: stonesByItem.get(id) ?? [] },
        fields: args.template.fields,
        payload: args.template.barcode_payload,
        costCodeWord: args.costCodeWord,
        shopName: args.shopName,
      }),
    )
    itemIds.push(id)
  }
  return { contents, itemIds }
}

/** One tag per collateral item of a loan, in position order. */
export async function loadCollateralTags(args: {
  supabase: Db
  tenantId: string
  loanId: string
  template: TagTemplate
}): Promise<{ contents: TagContent[]; ticketNumber: string | null }> {
  const { data: loan, error } = await args.supabase
    .from('loans')
    .select('id, ticket_number, due_date')
    .eq('tenant_id', args.tenantId)
    .eq('id', args.loanId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw new Error(`loan_lookup_failed: ${error.message}`)
  if (!loan?.ticket_number) return { contents: [], ticketNumber: null }

  const { data: items } = await args.supabase
    .from('loan_collateral_items')
    .select('position, description, metal_type, karat, weight_grams')
    .eq('tenant_id', args.tenantId)
    .eq('loan_id', loan.id)
    .is('deleted_at', null)
    .order('position')
  return {
    ticketNumber: loan.ticket_number,
    contents: (items ?? []).map((it) =>
      buildCollateralTag({
        item: { ...it, ticket_number: loan.ticket_number!, due_date: loan.due_date },
        fields: args.template.fields,
      }),
    ),
  }
}

export async function loadRepairTags(args: {
  supabase: Db
  tenantId: string
  ticketId: string
  template: TagTemplate
}): Promise<{ contents: TagContent[]; ticketNumber: string | null }> {
  const { data: t, error } = await args.supabase
    .from('repair_tickets')
    .select('id, ticket_number, title, promised_date')
    .eq('tenant_id', args.tenantId)
    .eq('id', args.ticketId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw new Error(`repair_lookup_failed: ${error.message}`)
  if (!t?.ticket_number) return { contents: [], ticketNumber: null }
  return {
    ticketNumber: t.ticket_number,
    contents: [
      buildRepairTag({
        item: { ticket_number: t.ticket_number, title: t.title, promised_date: t.promised_date },
        fields: args.template.fields,
      }),
    ],
  }
}
