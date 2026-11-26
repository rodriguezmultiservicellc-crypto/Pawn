import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { RepairStatus } from '@/types/database-aliases'
import { logAudit } from '@/lib/audit'
import { computeBalanceDue } from '@/lib/repair/billing'
import { canTransition } from '@/lib/repair/workflow'

/**
 * Put a quote on a repair ticket — the ONE way it is done: "Set quote" on the
 * ticket page, and a new ticket whose items all have a price (patches/0122).
 * Writes quote_amount + balance, moves an intake ticket to quoted, logs the
 * quote_set event and the audit row. The caller has run the guard and checked
 * the ticket is this shop's and not locked.
 */
export async function applyRepairQuote(args: {
  supabase: SupabaseClient<Database>
  tenantId: string
  userId: string
  ticket: { id: string; status: string; deposit_amount: number | string | null }
  amount: number
  notes: string | null
}): Promise<{ ok: true } | { error: string }> {
  const { supabase, tenantId, userId, ticket, amount, notes } = args
  const balance = computeBalanceDue({ quote: amount, deposit: ticket.deposit_amount })

  let nextStatus = ticket.status as RepairStatus
  if (ticket.status === 'intake' && canTransition('intake', 'quoted')) nextStatus = 'quoted'

  const { error: upErr } = await supabase
    .from('repair_tickets')
    .update({
      quote_amount: amount,
      quote_set_at: new Date().toISOString(),
      balance_due: balance,
      status: nextStatus,
      updated_by: userId,
    })
    .eq('id', ticket.id)
    .eq('tenant_id', tenantId)
  if (upErr) return { error: upErr.message }

  await supabase.from('repair_ticket_events').insert({
    ticket_id: ticket.id,
    tenant_id: tenantId,
    event_type: 'quote_set',
    amount,
    new_status: nextStatus !== ticket.status ? nextStatus : null,
    notes,
    performed_by: userId,
  })

  await logAudit({
    tenantId,
    userId,
    action: 'quote_set',
    tableName: 'repair_tickets',
    recordId: ticket.id,
    changes: { quote_amount: amount, new_status: nextStatus },
  })
  return { ok: true }
}
