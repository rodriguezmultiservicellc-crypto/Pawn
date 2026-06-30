/**
 * Resolve a tenant's NCIC TYP code map for police-report exports.
 *
 * Reads pawn_intake_categories.ncic_code (operator-editable at
 * /settings/pawn-categories) and returns a { slug → code } map. The
 * LeadsOnline flattener resolves each item's code from its pawn
 * subcategory slug (falling back to the top-level category slug).
 *
 * For a chain-HQ scope spanning multiple tenants the same slug may map to
 * different codes per shop; we take last-write-wins. Within a chain the
 * category taxonomy is normally shared, so collisions are not expected.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

export async function buildNcicBySlug(args: {
  supabase: SupabaseClient<Database>
  tenantIds: ReadonlyArray<string>
}): Promise<Record<string, string>> {
  if (args.tenantIds.length === 0) return {}

  const { data } = await args.supabase
    .from('pawn_intake_categories')
    .select('slug, ncic_code')
    .in('tenant_id', args.tenantIds as string[])
    .not('ncic_code', 'is', null)
    .is('deleted_at', null)

  const map: Record<string, string> = {}
  for (const r of (data ?? []) as Array<{ slug: string; ncic_code: string | null }>) {
    if (r.ncic_code) map[r.slug] = r.ncic_code
  }
  return map
}
