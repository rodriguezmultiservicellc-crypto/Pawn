import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { customerSearchFilters } from '@/lib/customers/search'
import { canMergeCustomers } from '@/lib/customers/merge'
import CustomersContent, { type CustomerListRow } from './content'

type SearchParams = Promise<{ q?: string; banned?: string }>

export default async function CustomersPage(props: {
  searchParams: SearchParams
}) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const params = await props.searchParams
  const q = (params.q ?? '').trim()
  const onlyBanned = params.banned === '1'

  let query = ctx.supabase
    .from('customers')
    .select(
      'id, first_name, last_name, phone, email, id_type, id_number, tags, is_banned, created_at',
    )
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(200)

  if (onlyBanned) query = query.eq('is_banned', true)

  if (q) {
    // Postgres OR across name/phone/email. The unaccent extension isn't
    // installed, so we ilike-search the raw columns. For Phase 1's
    // expected list size (≤ a few thousand) this is fine; we'll switch
    // to a tsvector / pg_trgm index when it matters.
    // Also match id_number (driver's license / state ID) so staff can look a
    // customer up by scanning or typing their ID.
    // Every word must match one column — "freddy rodriguez" works.
    for (const f of customerSearchFilters(q, ['first_name', 'last_name', 'phone', 'email', 'id_number'])) {
      query = query.or(f)
    }
  }

  const { data: customers } = await query

  return (
    <CustomersContent
      customers={(customers ?? []) as CustomerListRow[]}
      query={q}
      onlyBanned={onlyBanned}
      canMerge={canMergeCustomers(ctx.tenantRole)}
    />
  )
}
