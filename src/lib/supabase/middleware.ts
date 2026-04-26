import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import type { Database } from '@/types/database'
import type { GlobalRole, TenantRole } from '@/types/database-aliases'

export const ACTIVE_TENANT_COOKIE = 'pawn-active-tenant'

/**
 * Refreshes the Supabase session on every request, reads the user's global
 * role + tenant role for the active tenant, and returns a NextResponse with
 * the refreshed cookies attached. The proxy.ts file uses the returned
 * `response` to apply the cookies, then makes its routing decision based on
 * the role data.
 */
export async function updateSession(request: NextRequest): Promise<{
  response: NextResponse
  userId: string | null
  globalRole: GlobalRole
  tenantRole: TenantRole | null
  activeTenantId: string | null
}> {
  let response = NextResponse.next({ request })

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return {
      response,
      userId: null,
      globalRole: null,
      tenantRole: null,
      activeTenantId: null,
    }
  }

  const cookieTenantId = request.cookies.get(ACTIVE_TENANT_COOKIE)?.value ?? null

  // Resolve global role from profiles. profiles.role is GLOBAL only
  // ('superadmin' or NULL).
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, tenant_id')
    .eq('id', user.id)
    .maybeSingle()

  const globalRole = (profile?.role as GlobalRole) ?? null

  // Resolve active tenant: cookie wins; fall back to profile.tenant_id.
  const activeTenantId = cookieTenantId ?? (profile?.tenant_id as string | null) ?? null

  let tenantRole: TenantRole | null = null
  if (activeTenantId) {
    const { data: ut } = await supabase
      .from('user_tenants')
      .select('role')
      .eq('user_id', user.id)
      .eq('tenant_id', activeTenantId)
      .eq('is_active', true)
      .maybeSingle()
    tenantRole = (ut?.role as TenantRole) ?? null
  }

  return { response, userId: user.id, globalRole, tenantRole, activeTenantId }
}
