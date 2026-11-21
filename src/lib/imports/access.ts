import 'server-only'
import type { getCtx } from '@/lib/supabase/ctx'
import type { TenantRole } from '@/types/database-aliases'

/** Who may bulk-import into a shop (customers, inventory). */
export const IMPORT_ROLES: ReadonlySet<TenantRole> = new Set<TenantRole>(['owner', 'manager', 'chain_admin'])

type Ctx = NonNullable<Awaited<ReturnType<typeof getCtx>>>

/**
 * The caller's role for import purposes in the active tenant. A chain_admin
 * at the parent HQ counts for a child shop. Returns null when there is no
 * import-capable role.
 */
export async function resolveImportRole(ctx: Ctx): Promise<TenantRole | null> {
  if (!ctx.tenantId) return null
  if (ctx.tenantRole && IMPORT_ROLES.has(ctx.tenantRole)) return ctx.tenantRole
  const { data: t } = await ctx.supabase
    .from('tenants')
    .select('parent_tenant_id')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  if (t?.parent_tenant_id) {
    const { data: ca } = await ctx.supabase
      .from('user_tenants')
      .select('role')
      .eq('user_id', ctx.userId)
      .eq('tenant_id', t.parent_tenant_id)
      .eq('role', 'chain_admin')
      .eq('is_active', true)
      .maybeSingle()
    if (ca?.role === 'chain_admin') return 'chain_admin'
  }
  return null
}
