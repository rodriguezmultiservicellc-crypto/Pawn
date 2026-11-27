/**
 * LeadsOnline web service — the calls (server only).
 *
 * The shop's login: settings.leadsonline_api_store_id / _username / _env,
 * the password from Vault ('leadsonline_api_password'). The password never
 * leaves this file except inside the HTTPS request to LeadsOnline.
 */

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { getTenantSecret } from '@/lib/secrets/vault'
import {
  LEADSONLINE_ENDPOINTS,
  LEADSONLINE_NS,
  checkDoNotBuy2Envelope,
  checkLoginEnvelope,
  parseDoNotBuy,
  parseResponse,
  type DoNotBuyInfo,
  type LeadsOnlineEnv,
  type LeadsOnlineMethod,
  type LeadsOnlineResponse,
  type LoginInfo,
} from './soap'

export type LeadsOnlineConfig = { env: LeadsOnlineEnv; login: LoginInfo }

/** The shop's API login, or why there is none. */
export async function loadLeadsOnlineConfig(
  tenantId: string,
): Promise<{ ok: true; config: LeadsOnlineConfig } | { ok: false; error: 'not_configured' }> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('settings')
    .select('leadsonline_api_store_id, leadsonline_api_username, leadsonline_api_env')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  const password = await getTenantSecret(tenantId, 'leadsonline_api_password')
  if (!data?.leadsonline_api_store_id || !data.leadsonline_api_username || !password) {
    return { ok: false, error: 'not_configured' }
  }
  return {
    ok: true,
    config: {
      env: data.leadsonline_api_env === 'production' ? 'production' : 'sandbox',
      login: { storeId: data.leadsonline_api_store_id, userName: data.leadsonline_api_username, password },
    },
  }
}

/** The sandbox is slow (LeadsOnline says so); give it time. */
const TIMEOUT_MS = 90_000

/** POST one SOAP message; the raw answer, or the network error. */
export async function callLeadsOnline(
  env: LeadsOnlineEnv,
  method: LeadsOnlineMethod,
  body: string,
): Promise<{ ok: true; xml: string } | { ok: false; message: string }> {
  try {
    const res = await fetch(LEADSONLINE_ENDPOINTS[env], {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: `"${LEADSONLINE_NS}${method}"`,
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })
    const xml = await res.text()
    // A SOAP fault comes back as HTTP 500 with a body worth reading.
    if (!res.ok && !/Fault/.test(xml)) return { ok: false, message: `HTTP ${res.status}` }
    return { ok: true, xml }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'network_error' }
  }
}

export async function checkLogin(config: LeadsOnlineConfig): Promise<LeadsOnlineResponse> {
  const r = await callLeadsOnline(config.env, 'CheckLogin', checkLoginEnvelope(config.login))
  return r.ok ? parseResponse(r.xml) : { kind: 'fault', message: r.message }
}

export async function checkDoNotBuy(
  config: LeadsOnlineConfig,
  q: { id: string; name: string; birthDate: string },
): Promise<{ kind: 'hits'; hits: DoNotBuyInfo[] } | { kind: 'fault'; message: string }> {
  const r = await callLeadsOnline(config.env, 'CheckDoNotBuy2', checkDoNotBuy2Envelope(config.login, q))
  return r.ok ? parseDoNotBuy(r.xml) : { kind: 'fault', message: r.message }
}
