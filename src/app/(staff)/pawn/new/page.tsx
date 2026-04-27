import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import NewPawnLoanForm, { type CustomerOption } from './form'

export default async function NewPawnLoanPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  // Module gate.
  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_pawn')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  if (!tenant?.has_pawn) redirect('/dashboard')

  // Customer picker — list active customers (cap to a reasonable number).
  // For shops with thousands of customers we'd switch to a typeahead; in
  // Phase 2 a basic select is enough.
  const { data: customers } = await ctx.supabase
    .from('customers')
    .select('id, first_name, last_name, phone')
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .eq('is_banned', false)
    .order('last_name', { ascending: true })
    .limit(500)

  const options: CustomerOption[] = (customers ?? []).map((c) => ({
    id: c.id,
    label: `${c.last_name}, ${c.first_name}${c.phone ? ` · ${c.phone}` : ''}`,
  }))

  return <NewPawnLoanForm customers={options} />
}
