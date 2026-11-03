import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { dispatchMessage } from '@/lib/comms/dispatch'
import { formatMoney } from '@/lib/format/money'
import { trackingUrl } from './stages'

/**
 * "Text the customer the moment the piece is ready" — the optional
 * setting from brief Phase 1 (settings.repair_ready_auto_notify,
 * patches/0061).
 *
 * Called right after a ticket flips to 'ready' (markComplete, approveQa,
 * the board drag). Sends the tenant's `repair_ready` template through the
 * normal dispatcher (customer language + channel preference, message_log
 * row, Twilio / Resend creds from settings) with the tracking link as a
 * variable. The daily repair-ready cron remains the catch-up for shops
 * that leave the switch off; it already skips a ticket that has a
 * `repair_ready` row in message_log, so the two never double-send.
 *
 * Never throws: a comms hiccup must not undo a status transition that
 * already happened.
 */
export async function notifyRepairReadyIfEnabled(args: {
  tenantId: string
  ticketId: string
}): Promise<void> {
  try {
    const admin = createAdminClient()

    const { data: settings } = await admin
      .from('settings')
      .select('repair_ready_auto_notify')
      .eq('tenant_id', args.tenantId)
      .maybeSingle()
    if (!settings?.repair_ready_auto_notify) return

    const { data: ticket } = await admin
      .from('repair_tickets')
      .select('id, customer_id, ticket_number, balance_due, public_token, status')
      .eq('id', args.ticketId)
      .eq('tenant_id', args.tenantId)
      .is('deleted_at', null)
      .maybeSingle()
    if (!ticket || ticket.status !== 'ready') return

    // Already told them once (manual send, earlier flip, cron) → stay quiet.
    const { data: prior } = await admin
      .from('message_log')
      .select('id')
      .eq('tenant_id', args.tenantId)
      .eq('related_repair_ticket_id', ticket.id)
      .eq('kind', 'repair_ready')
      .limit(1)
    if (prior && prior.length > 0) return

    const res = await dispatchMessage({
      tenantId: args.tenantId,
      customerId: ticket.customer_id,
      kind: 'repair_ready',
      vars: {
        ticket_number: ticket.ticket_number ?? '',
        amount: formatMoney(Number(ticket.balance_due ?? 0)),
        tracking_link: trackingUrl(ticket.public_token) ?? '',
      },
      related: { repairTicketId: ticket.id },
    })
    if (!res.ok) {
      console.error('[repair.notify] ready notice not sent', res.reason, res.error)
    }
  } catch (err) {
    console.error('[repair.notify] unexpected', err)
  }
}
