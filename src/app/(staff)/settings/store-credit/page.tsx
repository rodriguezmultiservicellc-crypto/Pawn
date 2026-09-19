import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { createAdminClient } from '@/lib/supabase/admin'
import StoreCreditSettingsContent from './content'

const SETTINGS_ROLES = new Set(['owner', 'chain_admin'])

export default async function StoreCreditSettingsPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  if (!ctx.tenantRole || !SETTINGS_ROLES.has(ctx.tenantRole)) {
    redirect('/settings')
  }

  const { data: settings } = await createAdminClient()
    .from('settings')
    .select('store_credit_enabled, store_credit_expiry_days')
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle()
  if (!settings) redirect('/settings')

  return (
    <StoreCreditSettingsContent
      initial={{
        store_credit_enabled: settings.store_credit_enabled === true,
        store_credit_expiry_days: settings.store_credit_expiry_days ?? null,
      }}
    />
  )
}
