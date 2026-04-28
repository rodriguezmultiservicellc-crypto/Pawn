/**
 * eBay OAuth — start.
 *
 * GET /api/ebay/oauth/start
 *
 * Generates a CSRF-style state token, stores it in an HttpOnly cookie
 * scoped to /api/ebay/oauth/, and 302-redirects the user to eBay's
 * consent screen. The companion /callback route validates the state.
 *
 * STUB STAGE — when EBAY_CLIENT_ID / EBAY_REDIRECT_URI are unset, the
 * consent URL still renders but eBay will refuse it. The operator
 * populates these env vars after onboarding the developer account.
 *
 * Gated to staff (owner / chain_admin / manager) — pawn_clerk and
 * repair_tech don't get to wire up the integration.
 */

import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { startOAuth } from '@/lib/ebay/auth'
import type { EbayEnvironment } from '@/types/database-aliases'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STATE_COOKIE = 'pawn-ebay-oauth-state'
const STATE_TTL_SECONDS = 600 // 10 minutes

export async function GET(req: NextRequest) {
  const ctx = await getCtx()
  if (!ctx) {
    return NextResponse.redirect(new URL('/login', req.url))
  }
  if (!ctx.tenantId) {
    return NextResponse.redirect(new URL('/no-tenant', req.url))
  }
  await requireRoleInTenant(ctx.tenantId, [
    'owner',
    'chain_admin',
    'manager',
  ])

  const url = new URL(req.url)
  const env: EbayEnvironment =
    url.searchParams.get('env') === 'production' ? 'production' : 'sandbox'

  // State binds tenant + nonce so the callback can verify both.
  const nonce = randomUUID()
  const state = `${ctx.tenantId}:${nonce}`

  const { url: consentUrl } = startOAuth({
    tenantId: ctx.tenantId,
    state,
    environment: env,
  })

  const res = NextResponse.redirect(consentUrl)
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/ebay/oauth',
    maxAge: STATE_TTL_SECONDS,
  })
  // Stash the requested environment so the callback knows which OAuth host
  // to call back into.
  res.cookies.set('pawn-ebay-oauth-env', env, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/ebay/oauth',
    maxAge: STATE_TTL_SECONDS,
  })
  return res
}
