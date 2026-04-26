'use server'

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { ACTIVE_TENANT_COOKIE } from '@/lib/supabase/middleware'

export type ClaimResult = { error?: string }

/**
 * Claim a tenant via license_key. Calls claim_tenant_with_license_key RPC,
 * which:
 *   - validates the token + tenant active flag
 *   - inserts/upserts a user_tenants row with role='owner'
 *   - sets profiles.tenant_id to the tenant
 *   - consumes the license_key (one-time use)
 *
 * On success: sets the active-tenant cookie + redirects to /dashboard.
 * On failure: returns { error } for the client to render.
 *
 * Redirect throws NEXT_REDIRECT — must NOT be inside a try/catch.
 */
export async function claimTenantAction(token: string): Promise<ClaimResult> {
  if (!token || typeof token !== 'string') {
    return { error: 'invalid_token' }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect(
      `/login?next=${encodeURIComponent(`/onboard?token=${token}`)}`,
    )
  }

  const { data: claimedTenantId, error } = await supabase.rpc(
    'claim_tenant_with_license_key',
    {
      p_user_id: user.id,
      p_license_key: token,
    },
  )

  if (error) {
    return { error: error.message }
  }
  if (!claimedTenantId || typeof claimedTenantId !== 'string') {
    return { error: 'claim_failed' }
  }

  const cookieStore = await cookies()
  cookieStore.set(ACTIVE_TENANT_COOKIE, claimedTenantId, {
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  })

  redirect('/dashboard')
}
