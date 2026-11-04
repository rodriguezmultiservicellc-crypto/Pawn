import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadCustomQuoteSettings } from '@/lib/custom-quotes/settings'
import { loadQuoteSpotMap } from '@/lib/custom-quotes/spot'
import { getSpotFreshness } from '@/lib/spot-prices/lookup'
import { loadTenantRules } from '@/lib/jurisdictions/load'
import { todayInTimezone } from '@/lib/jurisdictions/rules'
import QuoteForm, { type StoneOption } from '@/components/custom-quotes/QuoteForm'

export const dynamic = 'force-dynamic'

export default async function NewQuotePage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_repair')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  if (!tenant?.has_repair) redirect('/dashboard')
  await requireRoleInTenant(ctx.tenantId, ['owner', 'manager', 'chain_admin', 'pawn_clerk', 'repair_tech'])

  const admin = createAdminClient()
  const [settings, spotMap, spotFreshness, rules, { data: stones }] = await Promise.all([
    loadCustomQuoteSettings(admin, ctx.tenantId),
    loadQuoteSpotMap(),
    getSpotFreshness(),
    loadTenantRules(admin, ctx.tenantId),
    ctx.supabase
      .from('inventory_items')
      .select('id, sku, description, cost_basis')
      .eq('tenant_id', ctx.tenantId)
      .eq('category', 'loose_stone')
      .eq('status', 'available')
      .is('deleted_at', null)
      .order('sku', { ascending: false })
      .limit(200),
  ])

  const stoneOptions: StoneOption[] = (stones ?? []).map((s) => ({
    id: s.id,
    sku: s.sku,
    description: s.description,
    cost_basis: Number(s.cost_basis ?? 0),
  }))

  return (
    <QuoteForm
      mode="create"
      settings={settings}
      spotMap={spotMap}
      stoneOptions={stoneOptions}
      spotFreshness={spotFreshness}
      today={todayInTimezone(rules.timezone)}
    />
  )
}
