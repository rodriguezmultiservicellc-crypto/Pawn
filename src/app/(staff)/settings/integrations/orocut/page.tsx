import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSecretConfigured } from '@/lib/secrets/vault'
import { orocutBaseUrl, orocutCallbackUrl } from '@/lib/orocut/client'
import { OPEN_LASER_STATUSES } from '@/lib/orocut/status'
import OrocutSettingsContent, { type OrocutSettingsView } from './content'

const SETTINGS_ROLES = new Set(['owner', 'chain_admin'])

/**
 * OroCut connection: the orocut.com order token (vault), the shop's style
 * names, and the webhook URL Sol Pawn hands orocut.com with every order.
 */
export default async function OrocutSettingsPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  if (!ctx.tenantRole || !SETTINGS_ROLES.has(ctx.tenantRole)) {
    redirect('/settings/integrations')
  }

  const admin = createAdminClient()
  const [{ data: settings }, tokenConfigured, webhookSecretConfigured, { count: openCount }] = await Promise.all([
    admin.from('settings').select('orocut_style_names').eq('tenant_id', ctx.tenantId).maybeSingle(),
    isSecretConfigured(ctx.tenantId, 'orocut_order_token'),
    isSecretConfigured(ctx.tenantId, 'orocut_webhook_secret'),
    admin
      .from('laser_orders')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .in('status', [...OPEN_LASER_STATUSES]),
  ])
  if (!settings) redirect('/settings/integrations')

  const view: OrocutSettingsView = {
    tokenConfigured,
    webhookSecretConfigured,
    styleNames: settings.orocut_style_names ?? [],
    webhookUrl: orocutCallbackUrl(),
    apiBase: orocutBaseUrl(),
    openOrders: openCount ?? 0,
  }
  return <OrocutSettingsContent view={view} />
}
