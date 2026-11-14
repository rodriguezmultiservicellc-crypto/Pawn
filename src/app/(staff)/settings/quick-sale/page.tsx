import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { QUICK_SALE_EDIT_ROLES } from '@/lib/pos/quick-sale'
import QuickSaleSettingsContent, { type QuickSaleRow } from './content'

export const dynamic = 'force-dynamic'

/** /settings/quick-sale — the POS quick sale buttons. Owners, chain admins, managers. */
export default async function QuickSaleSettingsPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  if (!ctx.tenantRole || !(QUICK_SALE_EDIT_ROLES as readonly string[]).includes(ctx.tenantRole)) redirect('/settings')

  const { data } = await ctx.supabase
    .from('quick_sale_buttons')
    .select('id, name, price, is_active')
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })

  const rows: QuickSaleRow[] = (data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    price: Number(r.price),
    is_active: r.is_active,
  }))

  return <QuickSaleSettingsContent rows={rows} />
}
