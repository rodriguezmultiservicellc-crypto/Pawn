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

/**
 * The customer accepted the quote — the ONE way it is recorded: "Approve"
 * on the ticket page (after the call: awaiting_approval), and New repair's
 * "quoted and approved at drop-off" (the ticket is only quoted: the
 * customer said yes at the counter, nobody calls). Stamps quote_approved_at,
 * writes the 'approved' event + audit, and moves the ticket on: to
 * 'assigned' when a technician is on it (it shows on their My jobs), else
 * 'in_progress'. The caller has run the guard and checked the ticket is
 * this shop's.
 */
export async function approveRepairQuote(args: {
  supabase: SupabaseClient<Database>
  tenantId: string
  userId: string
  ticket: { id: string; status: string; assigned_to: string | null; quote_amount: number | string | null }
  atDropoff: boolean
  notes: string | null
}): Promise<{ ok: true; status: RepairStatus } | { error: string }> {
  const { supabase, tenantId, userId, ticket } = args
  const from = ticket.status as RepairStatus
  // After the call the ticket waits for approval; at the counter it was
  // just quoted. Nothing else can be approved, and never without a quote.
  if (from !== 'awaiting_approval' && !(args.atDropoff && from === 'quoted')) {
    return { error: 'illegalTransition' }
  }
  if (ticket.quote_amount == null) return { error: 'quote_required' }
  const next: RepairStatus = ticket.assigned_to ? 'assigned' : 'in_progress'

  const { error } = await supabase
    .from('repair_tickets')
    .update({ status: next, quote_approved_at: new Date().toISOString(), updated_by: userId })
    .eq('id', ticket.id)
    .eq('tenant_id', tenantId)
    .eq('status', from)
  if (error) return { error: error.message }

  await supabase.from('repair_ticket_events').insert({
    ticket_id: ticket.id,
    tenant_id: tenantId,
    event_type: 'approved',
    new_status: next,
    notes: args.notes,
    performed_by: userId,
  })

  await logAudit({
    tenantId,
    userId,
    action: 'approve_quote',
    tableName: 'repair_tickets',
    recordId: ticket.id,
    changes: { new_status: next, at_dropoff: args.atDropoff },
  })
  return { ok: true, status: next }
}
