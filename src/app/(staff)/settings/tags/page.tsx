import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { loadTagShopContext, loadTagTemplates } from '@/lib/labels/load'
import TagsSettingsContent, { type TagSamples } from './content'

const VIEW_ROLES = new Set(['owner', 'chain_admin', 'manager'])
const EDIT_ROLES = new Set(['owner', 'chain_admin'])

/**
 * /settings/tags — tag templates and the cost code (patches/0074).
 * Managers can view and test print; owners edit (RLS: owner write).
 */
export default async function TagsSettingsPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  if (!ctx.tenantRole || !VIEW_ROLES.has(ctx.tenantRole)) redirect('/dashboard')
  const tenantId = ctx.tenantId

  const [templates, shop] = await Promise.all([
    loadTagTemplates(ctx.supabase, tenantId),
    loadTagShopContext(ctx.supabase, tenantId),
  ])

  // Something real to test print with, per kind (newest record).
  const [item, loan, repair] = await Promise.all([
    ctx.supabase.from('inventory_items').select('id').eq('tenant_id', tenantId).is('deleted_at', null)
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    shop.hasPawn
      ? ctx.supabase.from('loans').select('id').eq('tenant_id', tenantId).is('deleted_at', null)
          .not('ticket_number', 'is', null).order('created_at', { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
    shop.hasRepair
      ? ctx.supabase.from('repair_tickets').select('id').eq('tenant_id', tenantId).is('deleted_at', null)
          .not('ticket_number', 'is', null).order('created_at', { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  const samples: TagSamples = {
    inventory: item.data ? { ids: item.data.id } : null,
    collateral: loan.data ? { loan: loan.data.id } : null,
    repair: repair.data ? { ticket: repair.data.id } : null,
  }

  return (
    <TagsSettingsContent
      templates={templates}
      costCodeWord={shop.costCodeWord}
      canEdit={EDIT_ROLES.has(ctx.tenantRole)}
      kinds={{ inventory: true, collateral: shop.hasPawn, repair: shop.hasRepair }}
      samples={samples}
    />
  )
}
