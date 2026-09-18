import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { effectiveRules, toJurisdiction, type EffectiveRules } from './rules'

export const JURISDICTION_COLUMNS =
  'code, name, statute, default_timezone, rate_cap_monthly, rate_tiers, period_days, min_charge_cap, min_term_days, max_term_days, grace_days, grace_rolls_to_business_day, buy_hold_days, repair_abandon_days, record_retention_years, police_reporting_required, ticket_notices, ticket_backpage, verified_on'

/**
 * Resolve a tenant's jurisdiction + effective (statute-floored) rules.
 * Works with either the user-scoped client (jurisdictions is readable by
 * any authenticated user; tenants/settings by staff) or the admin client
 * (crons, PDF renderers).
 */
export async function loadTenantRules(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<EffectiveRules> {
  const [{ data: tenant }, { data: settings }] = await Promise.all([
    supabase
      .from('tenants')
      .select('jurisdiction_code, timezone')
      .eq('id', tenantId)
      .maybeSingle(),
    supabase
      .from('settings')
      .select('grace_period_days, buy_hold_period_days, abandoned_repair_days')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
  ])

  let jurisdiction = null
  if (tenant?.jurisdiction_code) {
    const { data: row } = await supabase
      .from('jurisdictions')
      .select(JURISDICTION_COLUMNS)
      .eq('code', tenant.jurisdiction_code)
      .maybeSingle()
    if (row) jurisdiction = toJurisdiction(row)
  }

  return effectiveRules({
    jurisdiction,
    timezone: tenant?.timezone ?? null,
    graceSetting: settings?.grace_period_days ?? null,
    buyHoldSetting: settings?.buy_hold_period_days ?? null,
    repairAbandonSetting: settings?.abandoned_repair_days ?? null,
  })
}
