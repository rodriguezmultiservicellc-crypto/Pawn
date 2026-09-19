import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  consignorBalances,
  isConsignmentEnabled,
} from '@/lib/consignment/payables'
import ConsignorsContent, { type ConsignorListRow } from './content'

const MANAGE_ROLES = new Set(['owner', 'manager', 'chain_admin'])

export default async function ConsignorsPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const admin = createAdminClient()
  const enabled = await isConsignmentEnabled(admin, ctx.tenantId)

  const { data: rows } = await ctx.supabase
    .from('consignors')
    .select(
      'id, consignor_number, business_name, default_commission_pct, status, customer:customers(id, first_name, last_name)',
    )
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .order('consignor_number', { ascending: true })

  type Row = {
    id: string
    consignor_number: string | null
    business_name: string | null
    default_commission_pct: number | string
    status: string
    customer: { id: string; first_name: string; last_name: string } | null
  }
  const consignorRows = (rows ?? []) as unknown as Row[]
  const ids = consignorRows.map((r) => r.id)

  // Open balance per consignor, and how many of their goods are still on
  // the floor. Both are read live — a cached figure on a money column is
  // worse than one more query.
  const [balances, { data: itemCounts }] = await Promise.all([
    consignorBalances(admin, { tenantId: ctx.tenantId, consignorIds: ids }),
    ids.length > 0
      ? admin
          .from('inventory_items')
          .select('consignor_id')
          .eq('tenant_id', ctx.tenantId)
          .in('consignor_id', ids)
          .in('status', ['available', 'held'])
          .is('deleted_at', null)
      : Promise.resolve({ data: [] as { consignor_id: string | null }[] }),
  ])

  const onFloor = new Map<string, number>()
  for (const row of itemCounts ?? []) {
    if (!row.consignor_id) continue
    onFloor.set(row.consignor_id, (onFloor.get(row.consignor_id) ?? 0) + 1)
  }

  const list: ConsignorListRow[] = consignorRows.map((r) => ({
    id: r.id,
    consignor_number: r.consignor_number ?? '',
    name:
      r.business_name ||
      (r.customer
        ? `${r.customer.last_name}, ${r.customer.first_name}`
        : '—'),
    customer_id: r.customer?.id ?? null,
    commission_pct: Number(r.default_commission_pct),
    status: r.status === 'inactive' ? 'inactive' : 'active',
    items_on_floor: onFloor.get(r.id) ?? 0,
    balance: balances.get(r.id) ?? 0,
  }))

  return (
    <ConsignorsContent
      consignors={list}
      enabled={enabled}
      canManage={!!ctx.tenantRole && MANAGE_ROLES.has(ctx.tenantRole)}
    />
  )
}
