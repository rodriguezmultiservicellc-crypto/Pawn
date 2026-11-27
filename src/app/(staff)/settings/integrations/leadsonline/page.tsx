import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSecretConfigured } from '@/lib/secrets/vault'
import { shopDateTime } from '@/lib/compliance/police-report/formats/fl-leadsonline-xml'
import LeadsOnlineSettingsContent, { type LeadsOnlineSettingsView } from './content'

const SETTINGS_ROLES = new Set(['owner', 'chain_admin'])

/**
 * LeadsOnline web service: the API login (store id, user name, password in
 * Vault), sandbox or production, a login test, a Do Not Buy check, and the
 * last tickets sent (patches/0123).
 */
export default async function LeadsOnlineSettingsPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  if (!ctx.tenantRole || !SETTINGS_ROLES.has(ctx.tenantRole)) {
    redirect('/settings/integrations')
  }

  // Service role after the role check: leadsonline_submissions has no
  // staff policy (patches/0123).
  const admin = createAdminClient()
  const [{ data: settings }, passwordSet, { data: recent }, { data: tenant }] = await Promise.all([
    admin
      .from('settings')
      .select('leadsonline_api_store_id, leadsonline_api_username, leadsonline_api_env')
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle(),
    isSecretConfigured(ctx.tenantId, 'leadsonline_api_password'),
    admin
      .from('leadsonline_submissions')
      .select('id, created_at, environment, method, ticket_type, ticket_number, is_void, images_sent, ok, error_code, error_response')
      .eq('tenant_id', ctx.tenantId)
      .order('created_at', { ascending: false })
      .limit(20),
    admin.from('tenants').select('timezone').eq('id', ctx.tenantId).maybeSingle(),
  ])
  const timeZone = tenant?.timezone || 'America/New_York'
  if (!settings) redirect('/settings/integrations')

  const view: LeadsOnlineSettingsView = {
    storeId: settings.leadsonline_api_store_id != null ? String(settings.leadsonline_api_store_id) : '',
    username: settings.leadsonline_api_username ?? '',
    env: settings.leadsonline_api_env === 'production' ? 'production' : 'sandbox',
    passwordSet,
    recent: (recent ?? []).map((r) => ({
      id: r.id,
      at: shopDateTime(r.created_at, timeZone).replace('T', ' ').slice(0, 16),
      env: r.environment === 'production' ? 'production' : 'sandbox',
      method: r.method,
      ticketType: r.ticket_type,
      ticketNumber: r.ticket_number,
      isVoid: r.is_void,
      images: r.images_sent,
      ok: r.ok,
      code: r.error_code,
      response: r.error_response ?? '',
    })),
  }
  return <LeadsOnlineSettingsContent view={view} />
}
