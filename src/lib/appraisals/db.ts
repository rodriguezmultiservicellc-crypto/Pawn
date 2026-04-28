/**
 * Typed-table escape hatch for the appraisal module.
 *
 * The appraisals / appraisal_stones / appraisal_photos tables ship in
 * patches/0014-appraisals.sql. Until 0014 is applied AND `npm run db:types`
 * has been run (operator step at merge), the auto-generated
 * src/types/database.ts has no entry for these tables, so
 * `supabase.from('appraisals')` does not type-check.
 *
 * This shim casts the supabase client to a loose `any`-table client at the
 * single call site that needs it, so the rest of the action / route code
 * remains strict. Once db:types regenerates, swap every consumer to the
 * regular client and delete this file.
 *
 * Tracking: see "TypeScript hacks for operator cleanup" in the Phase 9
 * (Path B) handoff.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LooseSupabaseClient = SupabaseClient<any, 'public', any>

/**
 * Widen a strictly-typed client to the loose shape so .from('appraisals')
 * accepts. Defense-in-depth via tenant_id filters in every call still
 * applies; this only relaxes the TypeScript table-name guard.
 */
export function asLoose(
  client: SupabaseClient<Database>,
): LooseSupabaseClient {
  return client as unknown as LooseSupabaseClient
}
