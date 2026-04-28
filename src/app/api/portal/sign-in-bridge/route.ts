import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ACTIVE_TENANT_COOKIE } from '@/lib/supabase/middleware'

/**
 * GET /api/portal/sign-in-bridge
 *
 * Hit this immediately after a portal customer's magic-link OTP is
 * verified. Looks up the customer's tenant via auth.uid → customers
 * (auth_user_id) → tenant_id, sets the pawn-active-tenant cookie, and
 * redirects to /portal/loans.
 *
 * Why a bridge: the (portal)/layout.tsx server component reads
 * ctx.tenantRole, which is computed in middleware against the
 * pawn-active-tenant cookie. If the cookie isn't set (or points at a
 * different tenant from the customer's record), the layout redirects
 * to /no-tenant. Setting the cookie here BEFORE the layout runs avoids
 * that bounce.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    const url = new URL('/portal/login', req.url)
    url.searchParams.set('error', 'session_expired')
    return NextResponse.redirect(url)
  }

  const admin = createAdminClient()
  // customers.auth_user_id is added in 0009. Until db:types regenerates
  // every consumer, we cast — the column is real on the server.
  type CustomerLink = { id: string; tenant_id: string }
  const lookup = await admin
    .from('customers')
    .select('id, tenant_id')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .eq('auth_user_id' as any, user.id)
    .is('deleted_at', null)
    .maybeSingle()
  const customer = (lookup.data ?? null) as CustomerLink | null

  if (!customer) {
    const url = new URL('/no-tenant', req.url)
    return NextResponse.redirect(url)
  }

  // Verify the matching client membership exists + is active. Without
  // this, a customer who was previously a client at a different tenant
  // could land on a stale tenant_id.
  const { data: membership } = await admin
    .from('user_tenants')
    .select('role, is_active')
    .eq('user_id', user.id)
    .eq('tenant_id', customer.tenant_id)
    .eq('role', 'client')
    .eq('is_active', true)
    .maybeSingle()
  if (!membership) {
    const url = new URL('/no-tenant', req.url)
    return NextResponse.redirect(url)
  }

  const dest = new URL('/portal/loans', req.url)
  const res = NextResponse.redirect(dest)
  res.cookies.set(ACTIVE_TENANT_COOKIE, customer.tenant_id, {
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  })
  return res
}
