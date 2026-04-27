import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import NewCustomerForm from './form'

export default async function NewCustomerPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_pawn')
    .eq('id', ctx.tenantId)
    .maybeSingle()

  return <NewCustomerForm hasPawn={tenant?.has_pawn ?? false} />
}
