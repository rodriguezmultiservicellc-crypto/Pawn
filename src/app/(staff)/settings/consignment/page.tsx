import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { createAdminClient } from '@/lib/supabase/admin'
import ConsignmentSettingsContent from './content'

const SETTINGS_ROLES = new Set(['owner', 'chain_admin'])

export default async function ConsignmentSettingsPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  if (!ctx.tenantRole || !SETTINGS_ROLES.has(ctx.tenantRole)) {
    redirect('/settings')
  }

  const { data: settings } = await createAdminClient()
    .from('settings')
    .select('consignment_enabled, consignment_default_commission_pct')
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle()
  if (!settings) redirect('/settings')

  return (
    <ConsignmentSettingsContent
      initial={{
        consignment_enabled: settings.consignment_enabled === true,
        consignment_default_commission_pct: Number(
          settings.consignment_default_commission_pct ?? 0.2,
        ),
      }}
    />
  )
}
