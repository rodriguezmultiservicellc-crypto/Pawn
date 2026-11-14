import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { QUICK_SALE_EDIT_ROLES } from '@/lib/pos/quick-sale'
import { loadQuickSaleButtons } from '@/lib/pos/quick-sale-server'
import type { InventoryPickRow } from '@/components/pos/AddInventoryItemDialog'
import QuickSaleSettingsContent, { type QuickSaleRow } from './content'

export const dynamic = 'force-dynamic'

/** /settings/quick-sale — the POS quick sale buttons. Owners, chain admins, managers. */
export default async function QuickSaleSettingsPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  if (!ctx.tenantRole || !(QUICK_SALE_EDIT_ROLES as readonly string[]).includes(ctx.tenantRole)) redirect('/settings')

  const [buttons, { data: items }] = await Promise.all([
    loadQuickSaleButtons(ctx.supabase, ctx.tenantId, { activeOnly: false }),
    // The same list the POS picker shows: sellable units, newest first.
    ctx.supabase
      .from('inventory_items')
      .select('id, sku, description, list_price, category')
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .eq('status', 'available')
      .order('created_at', { ascending: false })
      .limit(500),
  ])

  const rows: QuickSaleRow[] = buttons.map((b) =>
    b.kind === 'plain'
      ? { id: b.id, name: b.name, is_active: b.is_active, kind: 'plain', price: b.price }
      : { id: b.id, name: b.name, is_active: b.is_active, kind: 'product', inStock: b.units.length },
  )

  const inventory: InventoryPickRow[] = (items ?? []).map((i) => ({
    id: i.id,
    sku: i.sku,
    description: i.description,
    list_price: i.list_price == null ? null : Number(i.list_price),
    category: i.category,
  }))

  return <QuickSaleSettingsContent rows={rows} inventory={inventory} />
}
