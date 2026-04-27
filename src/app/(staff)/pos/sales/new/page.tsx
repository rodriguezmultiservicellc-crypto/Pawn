import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import NewSaleForm from './form'
import type { CustomerOption } from '@/components/pos/Cart'
import type { InventoryPickRow } from '@/components/pos/AddInventoryItemDialog'

type SearchParams = Promise<{ customer?: string }>

export default async function NewSalePage(props: {
  searchParams: SearchParams
}) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_retail')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  if (!tenant?.has_retail) redirect('/dashboard')

  // Block: must have an open register session.
  const { data: openSession } = await ctx.supabase
    .from('register_sessions')
    .select('id')
    .eq('tenant_id', ctx.tenantId)
    .eq('status', 'open')
    .is('deleted_at', null)
    .maybeSingle()
  if (!openSession) redirect('/pos')

  const params = await props.searchParams
  const initialCustomerId = params.customer ?? null

  const [{ data: customers }, { data: items }] = await Promise.all([
    ctx.supabase
      .from('customers')
      .select('id, first_name, last_name, phone')
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .eq('is_banned', false)
      .order('last_name', { ascending: true })
      .limit(500),
    ctx.supabase
      .from('inventory_items')
      .select('id, sku, description, list_price, category')
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .eq('status', 'available')
      .order('created_at', { ascending: false })
      .limit(500),
  ])

  const customerOpts: CustomerOption[] = (customers ?? []).map((c) => ({
    id: c.id,
    first_name: c.first_name,
    last_name: c.last_name,
    phone: c.phone,
  }))
  const inventoryOpts: InventoryPickRow[] = (items ?? []).map((i) => ({
    id: i.id,
    sku: i.sku,
    description: i.description,
    list_price: i.list_price == null ? null : Number(i.list_price),
    category: i.category,
  }))

  return (
    <NewSaleForm
      customers={customerOpts}
      inventory={inventoryOpts}
      initialCustomerId={initialCustomerId}
    />
  )
}
