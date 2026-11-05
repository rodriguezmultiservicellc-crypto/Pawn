/**
 * Shared guard for the /api/stripe/connect/* route handlers.
 *
 * Owner-tier only (owner | chain_admin at the active tenant) — the same
 * set the Integrations page uses to enable the Stripe actions. Returns
 * either the resolved context or a ready-made redirect response so each
 * route stays a straight line.
 */

import 'server-only'
import { NextResponse } from 'next/server'
import { getCtx } from '@/lib/supabase/ctx'
import { buildSettingsRedirect } from './connect-status'

const OWNER_ROLES = new Set(['owner', 'chain_admin'])

export type ConnectGuardOk = {
  ok: true
  tenantId: string
  userId: string
  appUrl: string
}

export type ConnectGuardFail = {
  ok: false
  response: NextResponse
}

export async function guardConnectOwner(
  reqUrl: string,
): Promise<ConnectGuardOk | ConnectGuardFail> {
  const ctx = await getCtx()
  if (!ctx) {
    return { ok: false, response: NextResponse.redirect(new URL('/login', reqUrl)) }
  }
  if (!ctx.tenantId) {
    return {
      ok: false,
      response: NextResponse.redirect(new URL('/no-tenant', reqUrl)),
    }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!appUrl) {
    // Without a canonical origin we cannot hand Stripe a return URL. Fall
    // back to the request origin only for the redirect itself.
    const target = new URL('/settings/integrations', reqUrl)
    target.searchParams.set('stripe', 'misconfigured')
    return { ok: false, response: NextResponse.redirect(target) }
  }

  if (!ctx.tenantRole || !OWNER_ROLES.has(ctx.tenantRole)) {
    return {
      ok: false,
      response: NextResponse.redirect(buildSettingsRedirect(appUrl, 'forbidden')),
    }
  }

  return { ok: true, tenantId: ctx.tenantId, userId: ctx.userId, appUrl }
}
