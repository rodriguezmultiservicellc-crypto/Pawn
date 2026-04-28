import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import NewAppraisalForm, {
  type CustomerOption,
  type InventoryOption,
} from './form'

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

  const { data: customers } = await ctx.supabase
    .from('customers')
    .select('id, first_name, last_name, phone')
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .eq('is_banned', false)
    .order('last_name', { ascending: true })
    .limit(500)

  const customerOptions: CustomerOption[] = (customers ?? []).map((c) => ({
    id: c.id,
    label: `${c.last_name}, ${c.first_name}${c.phone ? ` · ${c.phone}` : ''}`,
  }))

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
      customers={customerOptions}
      inventory={inventoryOptions}
      presetCustomerId={presetCustomerId}
      presetInventoryId={presetInventoryId}
    />
  )
}
