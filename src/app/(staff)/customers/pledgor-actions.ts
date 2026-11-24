'use server'

/**
 * Read-only: what the picked customer's record still lacks before a pawn or
 * a buy (FL 539.001(8)(b)). The intake actions refuse on the same check;
 * this only lets the screen say so before the clerk fills in the items.
 */

import { getCtx } from '@/lib/supabase/ctx'
import { requireStaff } from '@/lib/supabase/guards'
import {
  PLEDGOR_COLUMNS,
  missingPledgorFields,
  type PledgorField,
  type PledgorRecord,
} from '@/lib/customers/pledgor-record'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function loadPledgorGapsAction(
  customerId: string,
): Promise<{ ok: true; missing: PledgorField[] } | { ok: false }> {
  if (!UUID.test(customerId)) return { ok: false }
  const ctx = await getCtx()
  if (!ctx?.tenantId) return { ok: false }
  const { supabase } = await requireStaff(ctx.tenantId)
  const { data } = await supabase
    .from('customers')
    .select(PLEDGOR_COLUMNS)
    .eq('id', customerId)
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .maybeSingle<PledgorRecord>()
  if (!data) return { ok: false }
  return { ok: true, missing: missingPledgorFields(data) }
}
