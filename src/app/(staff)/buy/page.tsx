import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import BuyListContent, { type BuyListRow } from './content'

/**
 * Every buy of the shop, newest first (Eddy, 2026-11-25: "how do I open
 * [a buy] from the side menu"). One row per buy transaction: its
 * compliance_log row (event_type 'buy_outright'), which is the record of the
 * buy — the receipt page /buy/<id> is opened by the same row's source_id (the
 * first item's inventory id).
 *
 * Same gates as the buy pages: has_pawn, owner / manager / pawn_clerk /
 * chain_admin. The admin client reads compliance_log, as /buy/<id> does,
 * after the role guard and always filtered by this tenant.
 */
const PAGE_SIZE = 50

export default async function BuyListPage(props: {
  searchParams: Promise<{ q?: string; page?: string }>
}) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_pawn')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  if (!tenant?.has_pawn) redirect('/dashboard')

  await requireRoleInTenant(ctx.tenantId, [
    'owner',
    'manager',
    'pawn_clerk',
    'chain_admin',
  ])

  const params = await props.searchParams
  // Characters that would break the PostgREST or() filter are dropped.
  const q = (params.q ?? '').trim().replace(/[,()*\\]/g, ' ').trim()
  const page = Math.max(1, parseInt(params.page ?? '1', 10) || 1)
  const from = (page - 1) * PAGE_SIZE

  const admin = createAdminClient()
  let query = admin
    .from('compliance_log')
    .select(
      'id, source_id, reference_number, occurred_at, amount, customer_snapshot, items_snapshot',
      { count: 'exact' },
    )
    .eq('tenant_id', ctx.tenantId)
    .eq('source_table', 'inventory_items')
    .eq('event_type', 'buy_outright')
    .order('occurred_at', { ascending: false })
    .range(from, from + PAGE_SIZE - 1)

  if (q) {
    const like = `%${q.replace(/[%_]/g, (m) => '\\' + m)}%`
    query = query.or(
      [
        `reference_number.ilike.${like}`,
        `customer_snapshot->>first_name.ilike.${like}`,
        `customer_snapshot->>last_name.ilike.${like}`,
      ].join(','),
    )
  }

  const { data, count } = await query

  const rows: BuyListRow[] = (data ?? []).map((r) => {
    const cs = (r.customer_snapshot ?? {}) as Record<string, unknown>
    const items = (Array.isArray(r.items_snapshot) ? r.items_snapshot : []) as Array<
      Record<string, unknown>
    >
    const last = typeof cs.last_name === 'string' ? cs.last_name : ''
    const first = typeof cs.first_name === 'string' ? cs.first_name : ''
    return {
      id: r.source_id,
      ticketNumber: r.reference_number ?? null,
      occurredAt: r.occurred_at,
      customerName: [last, first].filter(Boolean).join(', ') || '—',
      itemCount: items.length,
      firstItem: typeof items[0]?.description === 'string' ? items[0].description : '',
      paid: r.amount != null ? Number(r.amount) : 0,
    }
  })

  return (
    <BuyListContent
      rows={rows}
      query={q}
      page={page}
      hasOlder={(count ?? 0) > from + rows.length}
    />
  )
}
