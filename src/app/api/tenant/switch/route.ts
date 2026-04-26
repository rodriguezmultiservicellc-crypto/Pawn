import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { ACTIVE_TENANT_COOKIE } from '@/lib/supabase/middleware'

/**
 * Switch the active tenant. POST { tenantId }.
 *
 * Defense in depth: verify the user has access to the target tenant
 * (direct user_tenants membership OR chain_admin at the parent) BEFORE
 * setting the cookie. RLS on the tenants table only filters reads — it
 * doesn't stop a malicious client from writing the cookie directly. The
 * proxy reads `tenantRole` based on the cookie; setting the cookie to a
 * tenant the user doesn't belong to would result in a NULL tenantRole
 * (so the proxy redirects to /no-tenant), but we still validate
 * defensively to avoid wasted round-trips and confusing redirects.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { tenantId?: string }
    | null

  const tenantId = body?.tenantId
  if (!tenantId || typeof tenantId !== 'string') {
    return NextResponse.json({ error: 'invalid_tenant' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // 1) Direct membership check.
  const { data: direct } = await supabase
    .from('user_tenants')
    .select('tenant_id')
    .eq('user_id', user.id)
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .maybeSingle()

  let allowed = !!direct

  // 2) Chain admin fallback: if the target tenant has a parent and the
  //    user is chain_admin at that parent, they're allowed.
  if (!allowed) {
    const { data: tenant } = await supabase
      .from('tenants')
      .select('parent_tenant_id')
      .eq('id', tenantId)
      .maybeSingle()

    if (tenant?.parent_tenant_id) {
      const { data: chainAdmin } = await supabase
        .from('user_tenants')
        .select('tenant_id')
        .eq('user_id', user.id)
        .eq('tenant_id', tenant.parent_tenant_id)
        .eq('role', 'chain_admin')
        .eq('is_active', true)
        .maybeSingle()
      allowed = !!chainAdmin
    }
  }

  if (!allowed) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const cookieStore = await cookies()
  cookieStore.set(ACTIVE_TENANT_COOKIE, tenantId, {
    httpOnly: false, // cosmetic only — the cookie is read on the server too
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365, // 1 year
  })

  return NextResponse.json({ ok: true })
}
