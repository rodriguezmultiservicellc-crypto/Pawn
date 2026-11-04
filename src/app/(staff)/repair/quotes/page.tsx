import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadTenantRules } from '@/lib/jurisdictions/load'
import { todayInTimezone } from '@/lib/jurisdictions/rules'
import { isExpired } from '@/lib/custom-quotes/math'
import QuotesListContent, { type QuoteListRow } from './content'
import type { CustomPieceCategory, CustomQuoteStatus } from '@/types/database-aliases'

export const dynamic = 'force-dynamic'

const STATUSES: ReadonlyArray<CustomQuoteStatus> = [
  'draft',
  'sent',
  'accepted',
  'declined',
  'expired',
  'converted',
  'voided',
]

export default async function QuotesListPage(props: {
  searchParams: Promise<{ status?: string }>
}) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_repair')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  if (!tenant?.has_repair) redirect('/dashboard')

  const { status } = await props.searchParams
  const filter = (status ?? 'open').trim()

  const rules = await loadTenantRules(createAdminClient(), ctx.tenantId)
  const today = todayInTimezone(rules.timezone)

  let query = ctx.supabase
    .from('custom_quotes')
    .select(
      `id, quote_number, status, category, description, price_total, cost_total, margin_pct, expires_on, created_at,
       customer:customers(first_name, last_name)`,
    )
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(300)
  if (filter === 'open') query = query.in('status', ['draft', 'sent', 'accepted'])
  else if (filter !== 'all' && STATUSES.includes(filter as CustomQuoteStatus)) {
    query = query.eq('status', filter as CustomQuoteStatus)
  }
  const { data } = await query

  const rows: QuoteListRow[] = (data ?? []).map((q) => {
    const c = (q as unknown as { customer: { first_name: string; last_name: string } | null }).customer
    const st = q.status as CustomQuoteStatus
    return {
      id: q.id,
      quote_number: q.quote_number ?? '',
      status: (st === 'draft' || st === 'sent') && isExpired(q.expires_on, today) ? 'expired' : st,
      category: q.category as CustomPieceCategory,
      description: q.description,
      customer_name: c ? `${c.last_name}, ${c.first_name}` : '—',
      price_total: Number(q.price_total),
      margin_pct: Number(q.margin_pct),
      expires_on: q.expires_on,
      created_at: q.created_at,
    }
  })

  return <QuotesListContent rows={rows} filter={filter} />
}
