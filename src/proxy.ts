import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

/**
 * Next 16 renamed `middleware.ts` → `proxy.ts` and the export name from
 * `middleware` → `proxy`. Don't rename it back. The runtime looks for the
 * `proxy` export specifically.
 *
 * Responsibilities:
 *   1. Refresh Supabase session cookies on every request (updateSession).
 *   2. Read the user's globalRole + tenantRole + activeTenantId.
 *   3. Gate routes by role.
 *   4. Send the user "home" — / redirects to whichever surface they belong
 *      on (admin / staff / portal / login).
 *
 * Public paths bypass auth entirely. Static + Next internals are skipped
 * via the matcher config at the bottom.
 */

const PUBLIC_PATHS = [
  '/login',
  '/magic-link',
  '/set-password',
  '/forgot-password',
  '/onboard',
  '/no-tenant',
  '/auth/callback',
]

const STAFF_PATH_PREFIXES = [
  '/dashboard',
  '/customers',
  '/inventory',
  '/pawn',
  '/repair',
  '/pos',
  '/reports',
  '/compliance',
  '/team',
  '/settings',
]

const STAFF_ROLES = new Set([
  'owner',
  'chain_admin',
  'manager',
  'pawn_clerk',
  'repair_tech',
  'appraiser',
])

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  )
}

function isStaffPath(pathname: string): boolean {
  return STAFF_PATH_PREFIXES.some((p) => pathname.startsWith(p))
}

function isAdminPath(pathname: string): boolean {
  return pathname.startsWith('/admin')
}

function isPortalPath(pathname: string): boolean {
  return pathname.startsWith('/portal')
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Public routes: refresh session but don't gate.
  if (isPublicPath(pathname)) {
    const { response } = await updateSession(request)
    return response
  }

  const { response, userId, globalRole, tenantRole, activeTenantId } =
    await updateSession(request)

  // Unauthenticated → /login (preserve the original destination for
  // post-login redirect). Skip for public paths handled above.
  if (!userId) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  // /admin/* requires globalRole=superadmin.
  if (isAdminPath(pathname)) {
    if (globalRole !== 'superadmin') {
      const url = request.nextUrl.clone()
      url.pathname = '/no-tenant'
      return NextResponse.redirect(url)
    }
    return response
  }

  // /portal/* requires tenantRole=client.
  if (isPortalPath(pathname)) {
    if (tenantRole !== 'client') {
      const url = request.nextUrl.clone()
      url.pathname = '/no-tenant'
      return NextResponse.redirect(url)
    }
    return response
  }

  // Staff routes require any staff role at the active tenant.
  if (isStaffPath(pathname)) {
    if (!tenantRole || !STAFF_ROLES.has(tenantRole)) {
      const url = request.nextUrl.clone()
      url.pathname = '/no-tenant'
      return NextResponse.redirect(url)
    }
    return response
  }

  // Root "/" — route by role.
  if (pathname === '/') {
    const url = request.nextUrl.clone()
    if (globalRole === 'superadmin') {
      url.pathname = '/admin/tenants'
    } else if (tenantRole === 'client') {
      url.pathname = '/portal'
    } else if (tenantRole && STAFF_ROLES.has(tenantRole)) {
      url.pathname = '/dashboard'
    } else if (activeTenantId === null) {
      url.pathname = '/no-tenant'
    } else {
      url.pathname = '/no-tenant'
    }
    return NextResponse.redirect(url)
  }

  // Anything else: pass through with refreshed session.
  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes — they handle their own auth)
     * - _next/static, _next/image (Next internals)
     * - favicon.ico, robots.txt, sitemap.xml
     * - file extensions (images, fonts, etc.)
     */
    '/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff|woff2|ttf|otf)).*)',
  ],
}
