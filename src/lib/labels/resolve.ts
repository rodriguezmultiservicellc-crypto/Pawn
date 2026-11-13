/**
 * Resolve a scanned code to a record in the active tenant. Server-only;
 * callers gate with requireStaff() first. Pure parsing lives in scan.ts.
 */

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { parseScan } from './scan'

type Db = SupabaseClient<Database>

export type ResolvedScan =
  | {
      kind: 'inventory'
      id: string
      sku: string
      description: string
      status: Database['public']['Enums']['inventory_status']
      list_price: number | null
      category: Database['public']['Enums']['inventory_category']
      href: string
    }
  | { kind: 'collateral'; loanId: string; ticketNumber: string; position: number; href: string }
  | { kind: 'repair'; ticketId: string; ticketNumber: string; href: string }
  | { kind: 'none'; code: string }

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`)
}

export async function resolveScan(supabase: Db, tenantId: string, raw: string): Promise<ResolvedScan> {
  const parsed = parseScan(raw)
  const code = raw.trim()
  if (parsed.kind === 'empty') return { kind: 'none', code }

  if (parsed.kind === 'collateral') {
    const { data: loan } = await supabase
      .from('loans')
      .select('id, ticket_number')
      .eq('tenant_id', tenantId)
      .eq('ticket_number', parsed.ticketNumber)
      .is('deleted_at', null)
      .maybeSingle()
    if (!loan) return { kind: 'none', code }
    const { data: item } = await supabase
      .from('loan_collateral_items')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('loan_id', loan.id)
      .eq('position', parsed.position - 1)
      .is('deleted_at', null)
      .maybeSingle()
    if (!item) return { kind: 'none', code }
    return {
      kind: 'collateral',
      loanId: loan.id,
      ticketNumber: parsed.ticketNumber,
      position: parsed.position,
      href: `/pawn/${loan.id}`,
    }
  }

  if (parsed.kind === 'repair') {
    const { data: t } = await supabase
      .from('repair_tickets')
      .select('id, ticket_number')
      .eq('tenant_id', tenantId)
      .eq('ticket_number', parsed.ticketNumber)
      .is('deleted_at', null)
      .maybeSingle()
    if (!t) return { kind: 'none', code }
    return { kind: 'repair', ticketId: t.id, ticketNumber: parsed.ticketNumber, href: `/repair/${t.id}` }
  }

  const cols = 'id, sku, description, status, list_price, category'
  let { data: item } = await supabase
    .from('inventory_items')
    .select(cols)
    .eq('tenant_id', tenantId)
    .ilike('sku', escapeLike(parsed.sku))
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()
  if (!item && parsed.skuNumber) {
    ;({ data: item } = await supabase
      .from('inventory_items')
      .select(cols)
      .eq('tenant_id', tenantId)
      .eq('sku_number', parsed.skuNumber)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle())
  }
  if (!item) return { kind: 'none', code }
  return {
    kind: 'inventory',
    id: item.id,
    sku: item.sku,
    description: item.description,
    status: item.status,
    list_price: item.list_price == null ? null : Number(item.list_price),
    category: item.category,
    href: `/inventory/${item.id}`,
  }
}
