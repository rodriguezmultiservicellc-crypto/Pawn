import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import {
  INVENTORY_PHOTOS_BUCKET,
  getSignedUrl,
} from '@/lib/supabase/storage'
import NewTransferForm, { type SiblingTenant, type TransferableItem } from './form'

/**
 * New inventory-transfer intake. Lists sibling shops in the same chain
 * and the active tenant's available inventory. If the active tenant is
 * standalone (no parent_tenant_id) or has no siblings, the form short-
 * circuits and renders an explainer instead.
 */
export default async function NewTransferPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  // Resolve the active tenant's parent + type. Standalone shops can't
  // transfer; chain HQs don't carry inventory in v1 either.
  const { data: activeTenant } = await ctx.supabase
    .from('tenants')
    .select('id, name, dba, tenant_type, parent_tenant_id')
    .eq('id', ctx.tenantId)
    .maybeSingle()

  if (!activeTenant) redirect('/no-tenant')

  const parentTenantId = activeTenant.parent_tenant_id
  const noSiblings = activeTenant.tenant_type !== 'shop' || !parentTenantId

  if (noSiblings || !parentTenantId) {
    return <NewTransferForm noSiblings siblings={[]} availableItems={[]} />
  }

  const { data: siblingsData } = await ctx.supabase
    .from('tenants')
    .select('id, name, dba')
    .eq('parent_tenant_id', parentTenantId)
    .eq('tenant_type', 'shop')
    .neq('id', ctx.tenantId)
    .order('name')

  const siblings: SiblingTenant[] = (siblingsData ?? []).map((s) => ({
    id: s.id,
    label: s.dba ?? s.name,
  }))

  if (siblings.length === 0) {
    return <NewTransferForm noSiblings siblings={[]} availableItems={[]} />
  }

  // Pull the available inventory (status='available'). We also pull a
  // primary photo path for each item so the table can render a thumbnail.
  const { data: items } = await ctx.supabase
    .from('inventory_items')
    .select(
      'id, sku, description, category, brand, model, list_price, cost_basis',
    )
    .eq('tenant_id', ctx.tenantId)
    .eq('status', 'available')
    .is('deleted_at', null)
    .order('sku_number', { ascending: false })
    .limit(500)

  const itemRows = items ?? []
  let thumbsByItem: Record<string, string | null> = {}
  if (itemRows.length > 0) {
    const ids = itemRows.map((r) => r.id)
    const { data: photos } = await ctx.supabase
      .from('inventory_item_photos')
      .select('item_id, storage_path, is_primary, position')
      .in('item_id', ids)
      .is('deleted_at', null)
      .order('is_primary', { ascending: false })
      .order('position', { ascending: true })

    const seen = new Set<string>()
    const tasks: Array<Promise<void>> = []
    for (const p of photos ?? []) {
      if (seen.has(p.item_id)) continue
      seen.add(p.item_id)
      tasks.push(
        getSignedUrl({
          bucket: INVENTORY_PHOTOS_BUCKET,
          path: p.storage_path,
          ttlSeconds: 3600,
        }).then((url) => {
          thumbsByItem = { ...thumbsByItem, [p.item_id]: url }
        }),
      )
    }
    await Promise.all(tasks)
  }

  const availableItems: TransferableItem[] = itemRows.map((r) => ({
    id: r.id,
    sku: r.sku,
    description: r.description,
    category: r.category,
    brand: r.brand,
    model: r.model,
    list_price: numericOrNull(r.list_price),
    cost_basis: numericOrNull(r.cost_basis),
    thumb_url: thumbsByItem[r.id] ?? null,
  }))

  return (
    <NewTransferForm
      noSiblings={false}
      siblings={siblings}
      availableItems={availableItems}
    />
  )
}

function numericOrNull(v: number | string | null): number | null {
  if (v == null) return null
  if (typeof v === 'number') return v
  const n = parseFloat(v)
  return isFinite(n) ? n : null
}
