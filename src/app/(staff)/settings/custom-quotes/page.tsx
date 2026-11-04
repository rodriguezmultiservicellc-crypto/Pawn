import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadCustomQuoteSettings } from '@/lib/custom-quotes/settings'
import CustomQuoteSettingsContent from './content'

const SETTINGS_ROLES = new Set(['owner', 'chain_admin', 'manager'])

/** /settings/custom-quotes — margin / deposit / validity / labor / breakdown policy. */
export default async function CustomQuoteSettingsPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  if (!ctx.tenantRole || !SETTINGS_ROLES.has(ctx.tenantRole)) redirect('/dashboard')

  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_repair')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  if (!tenant?.has_repair) redirect('/settings')

  const settings = await loadCustomQuoteSettings(createAdminClient(), ctx.tenantId)
  return <CustomQuoteSettingsContent initial={settings} />
}
