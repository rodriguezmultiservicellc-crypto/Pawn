/**
 * eBay OAuth — callback.
 *
 * GET /api/ebay/oauth/callback?code=...&state=...
 *
 * Validates the state cookie set by /api/ebay/oauth/start, exchanges the
 * authorization code for tokens via finishOAuth() (STUB returns synthetic
 * tokens), persists them on tenant_ebay_credentials, writes an audit row,
 * and redirects back to the integrations settings page with success=1.
 *
 * On error: redirects to the same page with ?error=<reason>.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getCtx } from '@/lib/supabase/ctx'
import { finishOAuth, persistTokens } from '@/lib/ebay/auth'
import { writeEvent } from '@/lib/ebay/client'
import { logAudit } from '@/lib/audit'
import type { EbayEnvironment } from '@/types/database-aliases'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STATE_COOKIE = 'pawn-ebay-oauth-state'
const ENV_COOKIE = 'pawn-ebay-oauth-env'

const SETTINGS_PATH = '/settings/integrations/ebay'

export async function GET(req: NextRequest) {
  const ctx = await getCtx()
  if (!ctx) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const stateFromQuery = url.searchParams.get('state')
  const errorParam = url.searchParams.get('error')

  const stateCookie = req.cookies.get(STATE_COOKIE)?.value ?? null
  const envCookie = (req.cookies.get(ENV_COOKIE)?.value as
    | EbayEnvironment
    | undefined) ?? 'sandbox'

  function fail(reason: string) {
    const target = new URL(SETTINGS_PATH, req.url)
    target.searchParams.set('error', reason)
    const res = NextResponse.redirect(target)
    // Clear cookies even on failure so a stale state doesn't outlive its
    // 10-minute TTL.
    res.cookies.set(STATE_COOKIE, '', {
      maxAge: 0,
      path: '/api/ebay/oauth',
    })
    res.cookies.set(ENV_COOKIE, '', {
      maxAge: 0,
      path: '/api/ebay/oauth',
    })
    return res
  }

  if (errorParam) return fail(`ebay_${errorParam}`)
  if (!code) return fail('missing_code')
  if (!stateFromQuery || !stateCookie) return fail('missing_state')
  if (stateFromQuery !== stateCookie) return fail('state_mismatch')

  // State format: <tenant_id>:<nonce>. Verify that the active session's
  // tenant matches the state's tenant — defense in depth.
  const [stateTenantId] = stateCookie.split(':')
  if (!stateTenantId || stateTenantId !== ctx.tenantId) {
    return fail('tenant_mismatch')
  }

  try {
    // STUB: synthesises tokens. Real impl exchanges `code` at the eBay
    // token endpoint with Basic-auth client credentials.
    const bundle = await finishOAuth({
      tenantId: ctx.tenantId,
      code,
      environment: envCookie,
    })

    await persistTokens({
      tenantId: ctx.tenantId,
      bundle,
      siteId: 'EBAY_US',
      connectedAt: new Date().toISOString(),
    })

    await writeEvent({
      tenantId: ctx.tenantId,
      listingId: null,
      kind: 'webhook_received',
      requestPayload: { kind: 'oauth_callback', code: '<redacted>' },
      responsePayload: { ebay_user_id: bundle.ebay_user_id },
      httpStatus: 200,
      errorText: null,
    })

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'ebay_oauth_connected',
      tableName: 'tenant_ebay_credentials',
      recordId: ctx.tenantId,
      changes: {
        ebay_user_id: bundle.ebay_user_id,
        environment: bundle.environment,
      },
    })

    const target = new URL(SETTINGS_PATH, req.url)
    target.searchParams.set('success', '1')
    const res = NextResponse.redirect(target)
    res.cookies.set(STATE_COOKIE, '', {
      maxAge: 0,
      path: '/api/ebay/oauth',
    })
    res.cookies.set(ENV_COOKIE, '', {
      maxAge: 0,
      path: '/api/ebay/oauth',
    })
    return res
  } catch (err) {
    console.error('[ebay] oauth callback failed', err)
    return fail('exchange_failed')
  }
}
