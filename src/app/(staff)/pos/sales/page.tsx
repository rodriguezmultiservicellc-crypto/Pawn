import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { loadTenantRules } from '@/lib/jurisdictions/load'
import { dayStartInTimezone } from '@/lib/jurisdictions/rules'
import { addDaysIso } from '@/lib/pawn/math'
import { toMoney } from '@/lib/pos/cart'
import type { SaleKind, SaleStatus } from '@/types/database-aliases'
import SaleHistoryContent, { type SaleHistoryRow } from './content'

/**
 * Sale history — every sale for the shop, newest first, with filters.
 * The /pos hub only shows the last 25; this is the full book. Linked from
 * the sidebar (POS → Sale history) and from a customer's Sales panel
 * (?customer=<id>).
 */

const PAGE_SIZE = 50
const STATUSES: ReadonlyArray<SaleStatus> = ['open', 'completed', 'voided']
const KINDS: ReadonlyArray<SaleKind> = ['retail', 'layaway', 'metal']
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f-]{36}$/i

type SearchParams = Promise<{
  status?: string
  kind?: string
  customer?: string
  from?: string
  to?: string
  q?: string
  page?: string
}>

export default async function SaleHistoryPage(props: { searchParams: SearchParams }) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_retail')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  if (!tenant?.has_retail) redirect('/dashboard')

  const params = await props.searchParams
  const status = STATUSES.includes(params.status as SaleStatus) ? (params.status as SaleStatus) : null
  const kind = KINDS.includes(params.kind as SaleKind) ? (params.kind as SaleKind) : null
  const customer = params.customer && UUID.test(params.customer) ? params.customer : null
  const from = params.from && ISO_DATE.test(params.from) ? params.from : null
  const to = params.to && ISO_DATE.test(params.to) ? params.to : null
  const q = (params.q ?? '').trim().replace(/[%_,()\\]/g, '').slice(0, 40)
  const page = Math.max(1, Math.floor(Number(params.page) || 1))

  // Date range is the shop's calendar day, not UTC's (CLAUDE.md rule 18).
  const { timezone } = await loadTenantRules(ctx.supabase, ctx.tenantId)

  let query = ctx.supabase
    .from('sales')
    .select(
      `id, sale_number, sale_kind, status, total, paid_total, completed_at, created_at, customer_id,
       customer:customers(id, first_name, last_name)`,
      { count: 'exact' },
    )
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)

  if (status) query = query.eq('status', status)
  if (kind) query = query.eq('sale_kind', kind)
  if (customer) query = query.eq('customer_id', customer)
  if (from) query = query.gte('created_at', dayStartInTimezone(from, timezone))
  if (to) query = query.lt('created_at', dayStartInTimezone(addDaysIso(to, 1), timezone))
  if (q) query = query.ilike('sale_number', `%${q}%`)

  const { data, count } = await query

  let customerName: string | null = null
  if (customer) {
    const { data: c } = await ctx.supabase
      .from('customers')
      .select('first_name, last_name')
      .eq('id', customer)
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle()
    customerName = c ? `${c.last_name}, ${c.first_name}` : null
  }

  const rows: SaleHistoryRow[] = (data ?? []).map((s) => {
    const c = (s as unknown as { customer: { id: string; first_name: string; last_name: string } | null }).customer
    return {
      id: s.id,
      sale_number: s.sale_number ?? '',
      sale_kind: s.sale_kind as SaleKind,
      status: s.status as SaleStatus,
      total: toMoney(s.total),
      paid_total: toMoney(s.paid_total),
      at: s.completed_at ?? s.created_at,
      customer_id: s.customer_id,
      customer_name: c ? `${c.last_name}, ${c.first_name}` : null,
    }
  })

  return (
    <SaleHistoryContent
      rows={rows}
      total={count ?? rows.length}
      page={page}
      pageSize={PAGE_SIZE}
      filters={{ status, kind, customer, from, to, q }}
      customerName={customerName}
    />
  )
}
