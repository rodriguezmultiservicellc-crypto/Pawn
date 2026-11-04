import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/** Per-tenant quoter policy (settings columns from patches/0063). */
export type CustomQuoteSettings = {
  /** Fraction, pre-filled on a new quote. */
  defaultMarginPct: number
  /** Fraction, the floor staff cannot go under. */
  minMarginPct: number
  /** Fraction of the total. */
  defaultDepositPct: number
  expiryDays: number
  /** USD per hour for bench labor. */
  laborRate: number
  /** Customer PDF / public page list price lines when TRUE. */
  showCostBreakdown: boolean
}

const FALLBACK: CustomQuoteSettings = {
  defaultMarginPct: 0.5,
  minMarginPct: 0.3,
  defaultDepositPct: 0.5,
  expiryDays: 14,
  laborRate: 75,
  showCostBreakdown: false,
}

export async function loadCustomQuoteSettings(
  client: SupabaseClient<Database>,
  tenantId: string,
): Promise<CustomQuoteSettings> {
  const { data } = await client
    .from('settings')
    .select(
      'custom_quote_default_margin_pct, custom_quote_min_margin_pct, custom_quote_default_deposit_pct, custom_quote_expiry_days, custom_quote_labor_rate, custom_quote_show_cost_breakdown',
    )
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!data) return FALLBACK
  return {
    defaultMarginPct: Number(data.custom_quote_default_margin_pct ?? FALLBACK.defaultMarginPct),
    minMarginPct: Number(data.custom_quote_min_margin_pct ?? FALLBACK.minMarginPct),
    defaultDepositPct: Number(data.custom_quote_default_deposit_pct ?? FALLBACK.defaultDepositPct),
    expiryDays: Number(data.custom_quote_expiry_days ?? FALLBACK.expiryDays),
    laborRate: Number(data.custom_quote_labor_rate ?? FALLBACK.laborRate),
    showCostBreakdown: data.custom_quote_show_cost_breakdown === true,
  }
}
