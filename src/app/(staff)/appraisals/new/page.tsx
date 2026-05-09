import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import NewAppraisalForm, { type InventoryOption } from './form'

type SearchParams = Promise<{
  customer?: string
  inventory?: string
}>

export default async function NewAppraisalPage(props: {
  searchParams: SearchParams
}) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const params = await props.searchParams
  const presetCustomerId = params.customer ?? null
  const presetInventoryId = params.inventory ?? null

  const { data: invItems } = await ctx.supabase
    .from('inventory_items')
    .select(
      'id, sku, description, metal, karat, weight_grams',
    )
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .order('sku', { ascending: false })
    .limit(500)

  const inventoryOptions: InventoryOption[] = (invItems ?? []).map((i) => ({
    id: i.id,
    label: `${i.sku} — ${i.description}`,
    description: i.description,
    metal: i.metal,
    karat: i.karat == null ? null : Number(i.karat),
    weight_grams: i.weight_grams == null ? null : Number(i.weight_grams),
  }))

  return (
    <NewAppraisalForm
      inventory={inventoryOptions}
      presetCustomerId={presetCustomerId}
      presetInventoryId={presetInventoryId}
    />
  )
}
