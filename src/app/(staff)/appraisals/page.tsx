import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { asLoose } from '@/lib/appraisals/db'
import AppraisalListContent, { type AppraisalListRow } from './content'
import type {
  AppraisalPurpose,
  AppraisalStatus,
} from '@/types/database-aliases'

type SearchParams = Promise<{
  q?: string
  status?: string
  purpose?: string
  customer?: string
}>

export default async function AppraisalListPage(props: {
  searchParams: SearchParams
}) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const params = await props.searchParams
  const q = (params.q ?? '').trim()
  const statusFilter = (params.status ?? 'all') as AppraisalStatus | 'all'
  const purposeFilter = (params.purpose ?? '') as AppraisalPurpose | ''
  const customerFilter = (params.customer ?? '').trim()

  let query = asLoose(ctx.supabase)
    .from('appraisals')
    .select(
      `id, appraisal_number, customer_id, item_description, purpose,
       appraised_value, valid_from, valid_until, status,
       appraiser_user_id, is_printed, created_at,
       customer:customers(id, first_name, last_name, phone)`,
    )
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(200)

  if (
    statusFilter === 'draft' ||
    statusFilter === 'finalized' ||
    statusFilter === 'voided'
  ) {
    query = query.eq('status', statusFilter)
  }
  if (purposeFilter) query = query.eq('purpose', purposeFilter)
  if (customerFilter) query = query.eq('customer_id', customerFilter)

  if (q) {
    const escaped = q.replace(/[%_]/g, (m) => '\\' + m)
    query = query.or(
      `appraisal_number.ilike.%${escaped}%,item_description.ilike.%${escaped}%`,
    )
  }

  const { data: appraisals } = await query

  // Counts per status (for chip badges).
  const [
    { count: countDraft },
    { count: countFinalized },
    { count: countVoided },
  ] = await Promise.all([
    asLoose(ctx.supabase)
      .from('appraisals')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .eq('status', 'draft'),
    asLoose(ctx.supabase)
      .from('appraisals')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .eq('status', 'finalized'),
    asLoose(ctx.supabase)
      .from('appraisals')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .eq('status', 'voided'),
  ])

  // Resolve appraiser names from profiles in one batch.
  const appraiserIds = Array.from(
    new Set(
      (appraisals ?? [])
        .map((a) => a.appraiser_user_id)
        .filter((v): v is string => !!v),
    ),
  )
  let appraiserNames: Record<string, string> = {}
  if (appraiserIds.length > 0) {
    const { data: profiles } = await ctx.supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', appraiserIds)
    appraiserNames = Object.fromEntries(
      (profiles ?? []).map((p) => [
        p.id,
        p.full_name?.trim() || p.email || p.id.slice(0, 8),
      ]),
    )
  }

  let rows: AppraisalListRow[] = (appraisals ?? []).map((a) => {
    const c = (
      a as unknown as {
        customer: {
          id: string
          first_name: string
          last_name: string
          phone: string | null
        } | null
      }
    ).customer
    return {
      id: a.id,
      appraisal_number: a.appraisal_number ?? '',
      customer_id: a.customer_id,
      customer_name: c ? `${c.last_name}, ${c.first_name}` : '—',
      customer_phone: c?.phone ?? null,
      item_description: a.item_description,
      purpose: a.purpose as AppraisalPurpose,
      appraised_value:
        a.appraised_value == null ? 0 : Number(a.appraised_value),
      valid_from: a.valid_from,
      valid_until: a.valid_until,
      status: a.status as AppraisalStatus,
      appraiser_user_id: a.appraiser_user_id,
      appraiser_name: a.appraiser_user_id
        ? appraiserNames[a.appraiser_user_id] ?? null
        : null,
      is_printed: a.is_printed,
      created_at: a.created_at,
    }
  })

  if (q) {
    const ql = q.toLowerCase()
    rows = rows.filter(
      (r) =>
        r.appraisal_number.toLowerCase().includes(ql) ||
        r.item_description.toLowerCase().includes(ql) ||
        r.customer_name.toLowerCase().includes(ql),
    )
  }

  return (
    <AppraisalListContent
      rows={rows}
      query={q}
      statusFilter={statusFilter}
      purposeFilter={purposeFilter}
      customerFilter={customerFilter}
      counts={{
        draft: countDraft ?? 0,
        finalized: countFinalized ?? 0,
        voided: countVoided ?? 0,
      }}
    />
  )
}
