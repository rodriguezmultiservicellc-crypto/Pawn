/**
 * The people a repair ticket can be assigned to (and whose time shows on
 * My jobs): the tenant's active staff in a repair-capable role. Server only;
 * the caller has already resolved the tenant and checked the role.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { TenantRole } from '@/types/database-aliases'

export type TechnicianOption = { id: string; label: string }

const ASSIGNABLE_ROLES: ReadonlySet<TenantRole> = new Set([
  'owner',
  'manager',
  'pawn_clerk',
  'repair_tech',
  'chain_admin',
])

/** Display name of a profile: full name, else email, else a short id. */
export function profileLabel(p: { id: string; full_name: string | null; email: string | null }): string {
  return p.full_name?.trim() || p.email || p.id.slice(0, 8)
}

export async function loadTechnicianOptions(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<TechnicianOption[]> {
  const { data: rows } = await supabase
    .from('user_tenants')
    .select('user_id, role')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
  const ids = (rows ?? [])
    .filter((u) => ASSIGNABLE_ROLES.has(u.role as TenantRole))
    .map((u) => u.user_id)
  if (ids.length === 0) return []
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .in('id', ids)
  return (profiles ?? [])
    .map((p) => ({ id: p.id, label: profileLabel(p) }))
    .sort((a, b) => a.label.localeCompare(b.label))
}
