import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { createAdminClient } from '@/lib/supabase/admin'
import { REPAIR_PHOTOS_BUCKET, getSignedUrl } from '@/lib/supabase/storage'
import { loadTenantRules } from '@/lib/jurisdictions/load'
import { todayInTimezone } from '@/lib/jurisdictions/rules'
import { loadQuoteDetail } from '@/lib/custom-quotes/load'
import { loadCustomQuoteSettings } from '@/lib/custom-quotes/settings'
import { quoteUrl } from '@/lib/custom-quotes/links'
import QuoteDetailContent from './content'

export const dynamic = 'force-dynamic'

export default async function QuoteDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_repair')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  if (!tenant?.has_repair) redirect('/dashboard')

  const admin = createAdminClient()
  const rules = await loadTenantRules(admin, ctx.tenantId)
  const today = todayInTimezone(rules.timezone)
  const [quote, settings] = await Promise.all([
    loadQuoteDetail({ client: ctx.supabase, tenantId: ctx.tenantId, quoteId: id, today }),
    loadCustomQuoteSettings(admin, ctx.tenantId),
  ])
  if (!quote) redirect('/repair/quotes')

  const photoUrl = quote.reference_photo_path
    ? await getSignedUrl({ bucket: REPAIR_PHOTOS_BUCKET, path: quote.reference_photo_path, ttlSeconds: 3600 })
    : null

  return (
    <QuoteDetailContent
      quote={quote}
      photoUrl={photoUrl}
      link={quoteUrl(quote.public_token)}
      showBreakdown={settings.showCostBreakdown}
    />
  )
}
