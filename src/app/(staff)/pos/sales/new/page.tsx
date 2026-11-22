import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import NewSaleForm from './form'
import type { InventoryPickRow } from '@/components/pos/AddInventoryItemDialog'
import { OUT_OF_STOCK_ADD_ROLES, QUICK_SALE_EDIT_ROLES } from '@/lib/pos/quick-sale'
import { loadQuickSaleButtons } from '@/lib/pos/quick-sale-server'
import { loadShopReader } from '@/lib/pos/reader-server'
import { LAYAWAY_TERMS_EDIT_ROLES } from '@/lib/pos/layaway-terms'
import { loadLayawayTerms } from '@/lib/pos/layaway-terms-server'
import { loadTaxRates } from '@/lib/pos/sales-tax-server'
import { fractionToPercent } from '@/lib/format/money'
import { tenantStripeReady, tenantStripeTestMode } from '@/lib/stripe/terminal'

type SearchParams = Promise<{ customer?: string }>

export default async function NewSalePage(props: {
  searchParams: SearchParams
}) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_retail, timezone')
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

  // The card reader is offered only when Stripe is set up on the platform
  // and the shop paired one (patches/0086); otherwise Card = card machine.
  const [stripeReady, testMode] = await Promise.all([
    tenantStripeReady(ctx.tenantId),
    tenantStripeTestMode(ctx.tenantId),
  ])
  const reader = stripeReady ? await loadShopReader(ctx.tenantId) : null

  const [{ data: items }, quickSales, layawayTerms, taxRates, { data: taxSetting }] = await Promise.all([
    ctx.supabase
      .from('inventory_items')
      .select('id, sku, description, list_price, category')
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .eq('status', 'available')
      .order('created_at', { ascending: false })
      .limit(500),
    loadQuickSaleButtons(ctx.supabase, ctx.tenantId, { activeOnly: true }),
    loadLayawayTerms(ctx.supabase, ctx.tenantId, { activeOnly: true }),
    loadTaxRates(ctx.supabase, ctx.tenantId, { activeOnly: true }),
    // The total a sale is charged: kept by the 0094 trigger = sum of the rates.
    ctx.supabase.from('settings').select('default_tax_rate').eq('tenant_id', ctx.tenantId).maybeSingle(),
  ])

  const inventoryOpts: InventoryPickRow[] = (items ?? []).map((i) => ({
    id: i.id,
    sku: i.sku,
    description: i.description,
    list_price: i.list_price == null ? null : Number(i.list_price),
    category: i.category,
  }))

  return (
    <NewSaleForm
      inventory={inventoryOpts}
      initialCustomerId={initialCustomerId}
      quickSales={quickSales}
      canEditQuickSales={!!ctx.tenantRole && (QUICK_SALE_EDIT_ROLES as readonly string[]).includes(ctx.tenantRole)}
      canAddOutOfStock={!!ctx.tenantRole && (OUT_OF_STOCK_ADD_ROLES as readonly string[]).includes(ctx.tenantRole)}
      reader={reader ? { label: reader.label } : null}
      stripeTestMode={testMode}
      layawayTerms={layawayTerms}
      shopTax={{
        percent: fractionToPercent(Number(taxSetting?.default_tax_rate ?? 0)),
        rates: taxRates,
      }}
      canEditLayawayTerms={!!ctx.tenantRole && (LAYAWAY_TERMS_EDIT_ROLES as readonly string[]).includes(ctx.tenantRole)}
      timezone={tenant.timezone}
    />
  )
}
