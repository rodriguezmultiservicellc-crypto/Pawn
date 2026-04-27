import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import NewReturnForm, { type NewReturnSale } from './form'
import { toMoney } from '@/lib/pos/cart'
import type { ReturnPickerSaleItem } from '@/components/pos/ReturnPicker'

type SearchParams = Promise<{ sale?: string }>

export default async function NewReturnPage(props: {
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

  const params = await props.searchParams
  const saleId = params.sale ?? null
  if (!saleId) redirect('/pos')

  const { data: sale } = await ctx.supabase
    .from('sales')
    .select(
      'id, tenant_id, sale_number, status, total, paid_total, returned_total',
    )
    .eq('id', saleId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!sale) redirect('/pos')

  const { data: itemsRows } = await ctx.supabase
    .from('sale_items')
    .select(
      'id, inventory_item_id, description, quantity, unit_price, returned_qty',
    )
    .eq('sale_id', sale.id)
    .is('deleted_at', null)
    .order('position', { ascending: true })

  const items: ReturnPickerSaleItem[] = (itemsRows ?? []).map((it) => ({
    id: it.id,
    description: it.description,
    quantity: Number(it.quantity),
    unit_price: Number(it.unit_price),
    returned_qty: Number(it.returned_qty ?? 0),
    has_inventory: !!it.inventory_item_id,
  }))

  const view: NewReturnSale = {
    id: sale.id,
    sale_number: sale.sale_number ?? '',
    status: sale.status as NewReturnSale['status'],
    total: toMoney(sale.total),
    paid_total: toMoney(sale.paid_total),
    returned_total: toMoney(sale.returned_total ?? 0),
  }

  return <NewReturnForm sale={view} items={items} />
}
