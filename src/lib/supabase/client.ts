import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/database'

/**
 * Browser-side Supabase client. Uses the anon key — RLS gates everything.
 * Safe to call from client components and the browser bundle.
 *
 * Never use this client for tenant-management or anything that relies on
 * service-role privileges; for that, use src/lib/supabase/admin.ts behind
 * a server-action guard.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
