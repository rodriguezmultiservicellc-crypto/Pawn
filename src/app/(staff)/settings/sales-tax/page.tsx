import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { SALES_TAX_EDIT_ROLES } from '@/lib/pos/sales-tax'
import { loadTaxRates } from '@/lib/pos/sales-tax-server'
import SalesTaxContent from './content'

export const dynamic = 'force-dynamic'

/** /settings/sales-tax — sales tax by district. Owners, chain admins, managers. */
export default async function SalesTaxPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  if (!ctx.tenantRole || !(SALES_TAX_EDIT_ROLES as readonly string[]).includes(ctx.tenantRole)) {
    redirect('/settings')
  }

  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_retail')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  if (!tenant?.has_retail) redirect('/settings')

  const rates = await loadTaxRates(ctx.supabase, ctx.tenantId, { activeOnly: false })
  return <SalesTaxContent rates={rates} />
}
