import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import type { Database } from '@/types/database'

/**
 * Server-side Supabase client (SSR + server actions + route handlers).
 * Uses the anon key — RLS still applies. Reads/writes session cookies via
 * Next 16's async cookies() API.
 *
 * Use this client when you need a user-scoped Supabase call inside a
 * server component, layout, page, or server action. For admin (service-
 * role) operations, use src/lib/supabase/admin.ts instead — gate it with
 * requireSuperAdmin() / requireRoleInTenant() FIRST.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // Server components can't write cookies — ignore. The proxy
            // middleware handles session refresh on every request.
          }
        },
      },
    },
  )
}
