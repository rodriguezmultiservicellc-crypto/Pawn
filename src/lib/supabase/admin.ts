import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * Service-role Supabase client. BYPASSES RLS.
 *
 * NEVER call this from a route or server action without first calling
 * requireSuperAdmin() or requireRoleInTenant() from src/lib/supabase/guards.ts.
 *
 * NEVER import this in any code that ends up in the client bundle (route
 * handlers, server actions, server components only).
 *
 * NEVER expose SUPABASE_SERVICE_ROLE_KEY via NEXT_PUBLIC_*. The key has
 * full database privileges; leaking it = total compromise.
 */
export function createAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  )
}
