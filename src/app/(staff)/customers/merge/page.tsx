import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { canMergeCustomers } from '@/lib/customers/merge'
import {
  findDuplicateGroups,
  type DuplicateCandidate,
} from '@/lib/customers/duplicates'
import MergeContent from './content'

type SearchParams = Promise<{ keep?: string; remove?: string }>

const PAGE = 1000
const MAX_ROWS = 50_000

export default async function CustomerMergePage(props: { searchParams: SearchParams }) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  if (!canMergeCustomers(ctx.tenantRole)) redirect('/customers')

  const params = await props.searchParams

  // Every live customer in this shop, a page at a time (PostgREST caps a
  // response at 1000 rows). RLS scopes it; the tenant filter is explicit too.
  const rows: DuplicateCandidate[] = []
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await ctx.supabase
      .from('customers')
      .select('id, first_name, last_name, phone, phone_alt, email, id_number, date_of_birth, created_at')
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error || !data) break
    rows.push(...data)
    if (data.length < PAGE) break
  }

  return (
    <MergeContent
      initialKeepId={params.keep ?? null}
      initialRemoveId={params.remove ?? null}
      duplicates={findDuplicateGroups(rows)}
    />
  )
}
