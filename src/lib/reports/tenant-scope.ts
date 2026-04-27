/**
 * Tenant-scope resolver for report queries.
 *
 * - For a `standalone` or `shop` tenant, the scope is just [tenantId].
 * - For a `chain_hq` tenant, the scope is the union of children visible to
 *   the current user (via my_chain_tenant_ids RLS helper, but we resolve
 *   the children explicitly in app code so we have an array to pass into
 *   `WHERE tenant_id = ANY ($)`).
 *
 * Returns { scope, isChainHq, tenantType } so callers can render the
 * cross-shop report differently.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { TenantType } from '@/types/database-aliases'

export type ReportTenantScope = {
  tenantIds: string[]
  isChainHq: boolean
  tenantType: TenantType | null
  storeId: string
  tenantName: string
}

export async function resolveReportScope(args: {
  supabase: SupabaseClient<Database>
  tenantId: string
}): Promise<ReportTenantScope> {
  const { supabase, tenantId } = args

  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('id, name, dba, tenant_type, parent_tenant_id')
    .eq('id', tenantId)
    .maybeSingle()
  if (error) throw new Error(`tenant_lookup_failed: ${error.message}`)
  if (!tenant) throw new Error('tenant_not_found')

  const tenantType = (tenant.tenant_type ?? null) as TenantType | null
  const tenantName = tenant.dba?.trim() || tenant.name
  // store_id fallback: use tenant.id UUID until a real agency-assigned id
  // lives on `tenants` (Phase 0 enum schema doesn't include it yet).
  const storeId = tenantId

  if (tenantType === 'chain_hq') {
    const { data: children } = await supabase
      .from('tenants')
      .select('id')
      .eq('parent_tenant_id', tenantId)
      .eq('is_active', true)
    const childIds = (children ?? []).map((c) => c.id)
    return {
      tenantIds: childIds,
      isChainHq: true,
      tenantType,
      storeId,
      tenantName,
    }
  }

  return {
    tenantIds: [tenantId],
    isChainHq: false,
    tenantType,
    storeId,
    tenantName,
  }
}
