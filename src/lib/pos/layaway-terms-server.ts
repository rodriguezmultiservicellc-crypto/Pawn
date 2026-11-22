import 'server-only'

/**
 * Loads a shop's layaway terms (patches/0093) in list order, through the
 * caller's own client (RLS). Used by the New sale page (active plans only)
 * and Settings → Layaway terms (all of them).
 */

import type { createClient } from '@/lib/supabase/server'
import type { LayawayScheduleKind } from '@/types/database-aliases'
import type { LayawayTerm } from './layaway-terms'

type Client = Awaited<ReturnType<typeof createClient>>

export async function loadLayawayTerms(
  supabase: Client,
  tenantId: string,
  opts: { activeOnly: boolean },
): Promise<LayawayTerm[]> {
  let q = supabase
    .from('layaway_terms')
    .select(
      'id, name, schedule_kind, down_payment_pct, first_payment_days, term_days, cancellation_fee_pct, is_default, is_active',
    )
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
  if (opts.activeOnly) q = q.eq('is_active', true)
  const { data: rows } = await q

  return (rows ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    schedule_kind: r.schedule_kind as LayawayScheduleKind,
    down_payment_pct: Number(r.down_payment_pct),
    first_payment_days: r.first_payment_days,
    term_days: r.term_days,
    cancellation_fee_pct: Number(r.cancellation_fee_pct),
    is_default: r.is_default,
    is_active: r.is_active,
  }))
}
