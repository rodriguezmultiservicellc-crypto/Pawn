import 'server-only'

/**
 * Loads a shop's sales tax rates (patches/0094), state first, through the
 * caller's own client (RLS). Used by the New sale page (active rates, for
 * the breakdown under the Tax field) and Settings → Sales tax (all of them).
 */

import type { createClient } from '@/lib/supabase/server'
import { byTaxLevel, type TaxLevel, type TaxRate } from './sales-tax'

type Client = Awaited<ReturnType<typeof createClient>>

export async function loadTaxRates(
  supabase: Client,
  tenantId: string,
  opts: { activeOnly: boolean },
): Promise<TaxRate[]> {
  let q = supabase
    .from('tax_rates')
    .select('id, name, level, rate, is_active')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
  if (opts.activeOnly) q = q.eq('is_active', true)
  const { data: rows } = await q

  return byTaxLevel(
    (rows ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      level: r.level as TaxLevel,
      rate: Number(r.rate),
      is_active: r.is_active,
    })),
  )
}
