/**
 * Twilio WhatsApp Business — approved-template sends.
 *
 * Twilio enforces template-only outbound for the first 24h of a conversation
 * (the "Initial Message" rule). Approved templates are referenced by Content
 * SID + variables ("Content API"), not by raw body. Tenants must complete the
 * Twilio + Meta WhatsApp Business approval flow PER TEMPLATE before any of
 * these messages can actually be delivered.
 *
 * For dev / pre-approval: when a template's whatsapp_content_sid is NULL, we
 * fall back to sending the rendered body verbatim (Twilio sandbox numbers
 * accept this; production numbers will reject).
 *
 * The Twilio POST + message_log state writes live in ./core. This file is
 * the WhatsApp credential resolver + form builder on top. No TCPA footer —
 * WhatsApp templates carry their own Meta-mandated opt-out, and in-session
 * freeform is customer-initiated.
 */

import 'server-only'
import { resolveTwilioCreds } from './sms'
import { runTwilioSend } from './core'
import type { MessageKind } from '@/types/database-aliases'
import type { RunTwilioSendResult } from './core'

export type SendWhatsAppResult = RunTwilioSendResult

export type SendWhatsAppArgs = {
  tenantId: string
  /** E.164 phone number, NO whatsapp: prefix (we add it). */
  to: string
  /** Approved template Content SID. NULL → freeform body fallback. */
  contentSid: string | null
  /** Variables for the approved template. Used as ContentVariables JSON. */
  contentVars?: Record<string, string>
  /** Rendered body — used as freeform fallback AND stored on message_log. */
  body: string
  kind: MessageKind
  customerId?: string | null
  relatedLoanId?: string | null
  relatedRepairTicketId?: string | null
  relatedLayawayId?: string | null
}

export async function sendWhatsApp(
  args: SendWhatsAppArgs,
): Promise<SendWhatsAppResult> {
  return runTwilioSend({
    channel: 'whatsapp',
    log: {
      tenant_id: args.tenantId,
      customer_id: args.customerId ?? null,
      related_loan_id: args.relatedLoanId ?? null,
      related_repair_ticket_id: args.relatedRepairTicketId ?? null,
      related_layaway_id: args.relatedLayawayId ?? null,
      kind: args.kind,
      to_address: args.to,
      body_rendered: args.body,
    },
    prepare: async () => {
      const creds = await resolveTwilioCreds(args.tenantId)
      if (!creds.accountSid || !creds.authToken) {
        return {
          ok: false,
          reason: 'missing_creds',
          error: 'Twilio account credentials not configured',
        }
      }
      const from = creds.whatsappFrom
      if (!from) {
        return {
          ok: false,
          reason: 'missing_from',
          error: 'twilio_whatsapp_from is not set',
        }
      }

      const form = new URLSearchParams()
      form.set('From', `whatsapp:${from}`)
      form.set('To', `whatsapp:${args.to}`)
      if (args.contentSid) {
        form.set('ContentSid', args.contentSid)
        if (args.contentVars && Object.keys(args.contentVars).length > 0) {
          form.set('ContentVariables', JSON.stringify(args.contentVars))
        }
      } else {
        // Freeform fallback — only valid against the Twilio WhatsApp sandbox
        // or within an open 24h conversation window. Production sends MUST set
        // contentSid (operator: populate after WhatsApp Business approval).
        form.set('Body', args.body)
      }

      return { ok: true, accountSid: creds.accountSid, authToken: creds.authToken, form }
    },
  })
}
