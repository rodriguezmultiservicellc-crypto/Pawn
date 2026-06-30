import { redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getCtx } from '@/lib/supabase/ctx'
import { parseDraftPayload } from '@/lib/pawn/intake-form'
import DraftsContent, { type DraftRow } from './content'

type DraftQueryRow = {
  id: string
  customer_id: string
  payload: unknown
  updated_at: string
  customer: { first_name: string; last_name: string; phone: string | null } | null
}

export default async function PawnDraftsPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_pawn')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  if (!tenant?.has_pawn) redirect('/dashboard')

  // loan_drafts isn't in the generated Database type until the next
  // `npm run db:types` after patches/0045; reach it via a generic client.
  const db = ctx.supabase as unknown as SupabaseClient
  const { data } = await db
    .from('loan_drafts')
    .select(
      'id, customer_id, payload, updated_at, customer:customers(first_name, last_name, phone)',
    )
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(200)

  const rows: DraftRow[] = ((data ?? []) as unknown as DraftQueryRow[]).map(
    (d) => {
      const p = parseDraftPayload(d.payload)
      const c = d.customer
      return {
        id: d.id,
        customerName: c ? `${c.last_name}, ${c.first_name}` : '—',
        customerPhone: c?.phone ?? null,
        itemCount: p.collateral.length,
        principal: p.principal.trim() === '' ? null : p.principal,
        updatedAt: d.updated_at,
      }
    },
  )

  return <DraftsContent rows={rows} />
}
