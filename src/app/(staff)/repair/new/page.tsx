import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import NewRepairTicketForm, { type TechnicianOption } from './form'

export default async function NewRepairTicketPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_repair')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  if (!tenant?.has_repair) redirect('/dashboard')

  // Staff users at this tenant for the technician picker. Two-step:
  // user_tenants → join to profiles by user_id (no FK across schemas).
  const { data: utRows } = await ctx.supabase
    .from('user_tenants')
    .select('user_id, role')
    .eq('tenant_id', ctx.tenantId)
    .eq('is_active', true)

  const userIds = (utRows ?? [])
    .filter((u) =>
      ['owner', 'manager', 'pawn_clerk', 'repair_tech', 'chain_admin'].includes(
        u.role,
      ),
    )
    .map((u) => u.user_id)

  let technicianOptions: TechnicianOption[] = []
  if (userIds.length > 0) {
    const { data: profiles } = await ctx.supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', userIds)
    technicianOptions = (profiles ?? []).map((p) => ({
      id: p.id,
      label: p.full_name?.trim() || p.email || p.id.slice(0, 8),
    }))
  }

  return <NewRepairTicketForm technicians={technicianOptions} />
}
