import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { createAdminClient } from '@/lib/supabase/admin'
import PawnCategoriesContent, { type CategoryRow } from './content'

const MANAGE_ROLES = new Set(['owner', 'chain_admin', 'manager'])

export default async function PawnCategoriesPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  // Module gate — pawn-only setting.
  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_pawn, has_firearms')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  if (!tenant?.has_pawn) redirect('/dashboard')

  const canManage = !!ctx.tenantRole && MANAGE_ROLES.has(ctx.tenantRole)
  const canFlipFirearms =
    ctx.tenantRole === 'owner' || ctx.tenantRole === 'chain_admin'

  // Fetch all categories (active + inactive, top-level + subs) for the
  // settings list.
  const admin = createAdminClient()
  const { data: rows } = await admin
    .from('pawn_intake_categories')
    .select(
      'id, slug, label, icon, sort_order, is_active, requires_ffl, parent_id, created_at',
    )
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })

  const categories: CategoryRow[] = (rows ?? []).map((r) => ({
    id: r.id,
    slug: r.slug,
    label: r.label,
    icon: r.icon,
    sort_order: r.sort_order,
    is_active: r.is_active,
    requires_ffl: r.requires_ffl,
    parent_id: r.parent_id,
  }))

  return (
    <PawnCategoriesContent
      categories={categories}
      hasFirearms={!!tenant.has_firearms}
      canManage={canManage}
      canFlipFirearms={canFlipFirearms}
    />
  )
}
