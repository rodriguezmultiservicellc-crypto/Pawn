/**
 * The LeadsOnline Do Not Buy check at a pawn or a buy (Eddy, 2026-11-27).
 *
 * People a police agency has told stores not to buy from. A shop with its
 * LeadsOnline login set up (patches/0123) checks the customer on New pawn /
 * Purchase / Buy outright as soon as they are picked (the banner), and
 * again when the ticket is written (the gate):
 *   - a match refuses the ticket ('do_not_buy_match');
 *   - LeadsOnline not answering does NOT stop the counter — the ticket goes
 *     through and the gap is in the audit log ('do_not_buy_unavailable');
 *   - a shop without the login is not checked.
 * The query is the customer's ID number, name and birth date
 * (CheckDoNotBuy2 takes the ID alone or any two).
 *
 * Server only; callers check the role first (rule 10).
 */

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit'
import { checkDoNotBuy, loadLeadsOnlineConfig } from './client'
import type { DoNotBuyInfo } from './soap'

export type DoNotBuyResult =
  | { status: 'off' }
  | { status: 'clear' }
  | { status: 'match'; hits: DoNotBuyInfo[] }
  | { status: 'unavailable'; message: string }

/** "1971-01-01" → "01/01/1971" (the format the sample sends). */
function usDate(iso: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
  return m ? `${m[2]}/${m[3]}/${m[1]}` : ''
}

export async function checkCustomerDoNotBuy(tenantId: string, customerId: string): Promise<DoNotBuyResult> {
  const cfg = await loadLeadsOnlineConfig(tenantId)
  if (!cfg.ok) return { status: 'off' }

  const admin = createAdminClient()
  const { data: c } = await admin
    .from('customers')
    .select('first_name, last_name, date_of_birth, id_number')
    .eq('id', customerId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!c) return { status: 'unavailable', message: 'customer_not_found' }

  const id = (c.id_number ?? '').trim()
  const name = [c.first_name, c.last_name].map((v) => (v ?? '').trim()).filter(Boolean).join(' ').toUpperCase()
  const birthDate = usDate(c.date_of_birth)
  if (!id && [name, birthDate].filter(Boolean).length < 2) {
    return { status: 'unavailable', message: 'not_enough' }
  }

  const r = await checkDoNotBuy(cfg.config, { id, name, birthDate })
  if (r.kind === 'fault') return { status: 'unavailable', message: r.message }
  return r.hits.length > 0 ? { status: 'match', hits: r.hits } : { status: 'clear' }
}

/** Writing a pawn ticket or a buy: refuse a Do Not Buy match. */
export async function doNotBuyGate(args: {
  tenantId: string
  customerId: string
  userId: string
  context: 'pawn_intake' | 'buy_intake'
}): Promise<{ ok: true } | { ok: false; code: 'do_not_buy_match' }> {
  const r = await checkCustomerDoNotBuy(args.tenantId, args.customerId)
  if (r.status === 'match' || r.status === 'unavailable') {
    await logAudit({
      tenantId: args.tenantId,
      userId: args.userId,
      action: r.status === 'match' ? 'do_not_buy_match' : 'do_not_buy_unavailable',
      tableName: 'customers',
      recordId: args.customerId,
      changes:
        r.status === 'match'
          ? { context: args.context, hits: r.hits.map((h) => ({ agency: h.agency, name: h.name, dob: h.dob })) }
          : { context: args.context, message: r.message },
    })
  }
  return r.status === 'match' ? { ok: false, code: 'do_not_buy_match' } : { ok: true }
}
