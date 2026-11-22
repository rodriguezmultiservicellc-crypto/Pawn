import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { LAYAWAY_TERMS_EDIT_ROLES } from '@/lib/pos/layaway-terms'
import { loadLayawayTerms } from '@/lib/pos/layaway-terms-server'
import LayawayTermsContent from './content'

export const dynamic = 'force-dynamic'

/** /settings/layaway-terms — the shop's saved layaway plans. Owners, chain admins, managers. */
export default async function LayawayTermsPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  if (!ctx.tenantRole || !(LAYAWAY_TERMS_EDIT_ROLES as readonly string[]).includes(ctx.tenantRole)) {
    redirect('/settings')
  }

  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_retail')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  if (!tenant?.has_retail) redirect('/settings')

  const terms = await loadLayawayTerms(ctx.supabase, ctx.tenantId, { activeOnly: false })
  return <LayawayTermsContent terms={terms} />
}
