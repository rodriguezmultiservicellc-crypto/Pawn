'use server'

import { getCtx } from '@/lib/supabase/ctx'
import { requireStaff } from '@/lib/supabase/guards'

export type SearchModule = 'sales' | 'layaways' | 'pawn' | 'repairs'

export type SearchTone = 'success' | 'warning' | 'error' | 'muted'

export type SearchResult = {
  id: string
  primary: string
  secondary?: string
  customer?: { name: string }
  status?: { label: string; tone: SearchTone }
  href: string
}

const MAX_RESULTS = 8

export async function searchAcrossModule(
  module: SearchModule,
  query: string,
): Promise<SearchResult[]> {
  const q = (query ?? '').trim()
  if (q.length < 1) return []

  const ctx = await getCtx()
  if (!ctx || !ctx.tenantId) return []
  const { supabase } = await requireStaff(ctx.tenantId)
  const like = `%${q}%`

  if (module === 'pawn') {
    const { data } = await supabase
      .from('loans')
      .select(
        'id, ticket_number, status, due_date, principal, customer:customers(first_name, last_name)',
      )
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .ilike('ticket_number', like)
      .limit(MAX_RESULTS)
    return (data ?? []).map((r) => ({
      id: r.id,
      primary: r.ticket_number ?? r.id.slice(0, 8),
      secondary: r.due_date ? `Due ${r.due_date}` : undefined,
      customer: customerName(r.customer),
      status: loanStatusPill(r.status),
      href: `/pawn/${r.id}`,
    }))
  }

  if (module === 'sales') {
    const { data } = await supabase
      .from('sales')
      .select(
        'id, sale_number, status, total, completed_at, customer:customers(first_name, last_name)',
      )
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .ilike('sale_number', like)
      .limit(MAX_RESULTS)
    return (data ?? []).map((r) => ({
      id: r.id,
      primary: r.sale_number ?? r.id.slice(0, 8),
      secondary:
        r.total != null ? `$${Number(r.total).toFixed(2)}` : undefined,
      customer: customerName(r.customer),
      status: saleStatusPill(r.status),
      href: `/pos/sales/${r.id}`,
    }))
  }

  if (module === 'layaways') {
    const { data } = await supabase
      .from('layaways')
      .select(
        'id, layaway_number, status, balance_remaining, customer:customers(first_name, last_name)',
      )
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .ilike('layaway_number', like)
      .limit(MAX_RESULTS)
    return (data ?? []).map((r) => ({
      id: r.id,
      primary: r.layaway_number ?? r.id.slice(0, 8),
      secondary:
        r.balance_remaining != null
          ? `$${Number(r.balance_remaining).toFixed(2)} owed`
          : undefined,
      customer: customerName(r.customer),
      status: layawayStatusPill(r.status),
      href: `/pos/layaways/${r.id}`,
    }))
  }

  if (module === 'repairs') {
    const { data } = await supabase
      .from('repair_tickets')
      .select(
        'id, ticket_number, status, customer:customers(first_name, last_name)',
      )
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .ilike('ticket_number', like)
      .limit(MAX_RESULTS)
    return (data ?? []).map((r) => ({
      id: r.id,
      primary: r.ticket_number ?? r.id.slice(0, 8),
      secondary: undefined,
      customer: customerName(r.customer),
      status: repairStatusPill(r.status),
      href: `/repair/${r.id}`,
    }))
  }

  return []
}

type CustomerSlim = { first_name: string; last_name: string }

function customerName(
  c: CustomerSlim | CustomerSlim[] | null | undefined,
): { name: string } | undefined {
  const row = Array.isArray(c) ? c[0] : c
  if (!row) return undefined
  const first = row.first_name?.trim() ?? ''
  const last = row.last_name?.trim() ?? ''
  const name = `${first} ${last}`.trim()
  return name ? { name } : undefined
}

function loanStatusPill(s: string | null): SearchResult['status'] {
  switch (s) {
    case 'active':
    case 'extended':
    case 'partial_paid':
      return { label: 'Active', tone: 'success' }
    case 'redeemed':
      return { label: 'Redeemed', tone: 'muted' }
    case 'forfeited':
      return { label: 'Forfeit', tone: 'error' }
    case 'voided':
      return { label: 'Void', tone: 'muted' }
    default:
      return undefined
  }
}

function saleStatusPill(s: string | null): SearchResult['status'] {
  switch (s) {
    case 'completed':
      return { label: 'Done', tone: 'muted' }
    case 'voided':
      return { label: 'Void', tone: 'error' }
    case 'open':
      return { label: 'Open', tone: 'warning' }
    default:
      return undefined
  }
}

function layawayStatusPill(s: string | null): SearchResult['status'] {
  switch (s) {
    case 'active':
      return { label: 'Active', tone: 'success' }
    case 'completed':
      return { label: 'Done', tone: 'muted' }
    case 'cancelled':
      return { label: 'Cancelled', tone: 'muted' }
    default:
      return undefined
  }
}

function repairStatusPill(s: string | null): SearchResult['status'] {
  switch (s) {
    case 'ready':
      return { label: 'Ready', tone: 'success' }
    case 'in_progress':
    case 'needs_parts':
      return { label: 'WIP', tone: 'warning' }
    case 'picked_up':
      return { label: 'Done', tone: 'muted' }
    case 'abandoned':
      return { label: 'Abandoned', tone: 'error' }
    default:
      return undefined
  }
}
