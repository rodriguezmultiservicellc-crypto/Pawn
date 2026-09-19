import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  defaultCommissionPct,
  isConsignmentEnabled,
} from '@/lib/consignment/payables'
import NewConsignorForm from './form'

const MANAGE_ROLES = new Set(['owner', 'manager', 'chain_admin'])

export default async function NewConsignorPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  if (!ctx.tenantRole || !MANAGE_ROLES.has(ctx.tenantRole)) {
    redirect('/consignors')
  }

  const admin = createAdminClient()
  if (!(await isConsignmentEnabled(admin, ctx.tenantId))) {
    redirect('/consignors')
  }

  return (
    <NewConsignorForm
      defaultCommissionPct={await defaultCommissionPct(admin, ctx.tenantId)}
    />
  )
}
