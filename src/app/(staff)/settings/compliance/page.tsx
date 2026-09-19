import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { createAdminClient } from '@/lib/supabase/admin'
import { JURISDICTION_COLUMNS, loadTenantRules } from '@/lib/jurisdictions/load'
import { toJurisdiction } from '@/lib/jurisdictions/rules'
import ComplianceSettingsContent from './content'

const VIEW_ROLES = new Set(['owner', 'chain_admin', 'manager'])
const EDIT_ROLES = new Set(['owner', 'chain_admin'])

/**
 * /settings/compliance — jurisdiction, timezone, and the tenant's own
 * grace / buy-hold / repair-abandon periods (floored by statute).
 * View: owner / chain_admin / manager. Edit: owner / chain_admin.
 */
export default async function ComplianceSettingsPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  if (!ctx.tenantRole || !VIEW_ROLES.has(ctx.tenantRole)) redirect('/dashboard')

  const admin = createAdminClient()
  const [jurRes, tenantRes, settingsRes, rules, listRes] = await Promise.all([
    admin
      .from('jurisdictions')
      .select(JURISDICTION_COLUMNS)
      .eq('is_active', true)
      .order('country')
      .order('name'),
    admin
      .from('tenants')
      .select('jurisdiction_code, timezone')
      .eq('id', ctx.tenantId)
      .maybeSingle(),
    admin
      .from('settings')
      .select(
        'grace_period_days, buy_hold_period_days, abandoned_repair_days, ofac_screening_enabled',
      )
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle(),
    loadTenantRules(admin, ctx.tenantId),
    admin
      .from('ofac_list_versions')
      .select('published_on, fetched_at, individual_count')
      .eq('is_current', true)
      .maybeSingle(),
  ])

  return (
    <ComplianceSettingsContent
      canEdit={EDIT_ROLES.has(ctx.tenantRole)}
      jurisdictions={(jurRes.data ?? []).map(toJurisdiction)}
      current={{
        jurisdictionCode: tenantRes.data?.jurisdiction_code ?? null,
        timezone: tenantRes.data?.timezone ?? rules.timezone,
        gracePeriodDays: settingsRes.data?.grace_period_days ?? null,
        buyHoldPeriodDays: settingsRes.data?.buy_hold_period_days ?? 30,
        abandonedRepairDays: settingsRes.data?.abandoned_repair_days ?? 90,
        ofacEnabled: settingsRes.data?.ofac_screening_enabled ?? true,
      }}
      ofacList={
        listRes.data
          ? {
              publishedOn: listRes.data.published_on,
              fetchedAt: listRes.data.fetched_at,
              individuals: listRes.data.individual_count,
            }
          : null
      }
      effective={{
        graceDays: rules.graceDays,
        buyHoldDays: rules.buyHoldDays,
        repairAbandonDays: rules.repairAbandonDays,
        retentionYears: rules.retentionYears,
      }}
    />
  )
}
