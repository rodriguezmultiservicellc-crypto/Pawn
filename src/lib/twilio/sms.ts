/**
 * Twilio Programmable Messaging — SMS.
 *
 * Per-tenant credentials live in `settings` (account SID, From number,
 * optional Messaging Service SID); the auth token lives in the Vault
 * (`getTenantSecret`). The Twilio POST + double-state logging to
 * message_log live in ./core — this file is the SMS-flavored credential
 * resolver + form builder on top.
 *
 * SMS bodies get the TCPA opt-out footer ("Reply STOP to unsubscribe…")
 * appended via withComplianceFooter before send AND before logging, so the
 * stored body matches what the customer received.
 *
 * resolveTwilioCreds() is shared with whatsapp.ts (re-imported there).
 */

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { getTenantSecret } from '@/lib/secrets/vault'
import { runTwilioSend } from './core'
import { withComplianceFooter } from './compliance'
import type { MessageKind, SettingsCommsColumns } from '@/types/database-aliases'
import type { RunTwilioSendResult } from './core'

export type SendSmsResult = RunTwilioSendResult

export type SendSmsArgs = {
  tenantId: string
  to: string
  body: string
  kind: MessageKind
  customerId?: string | null
  relatedLoanId?: string | null
  relatedRepairTicketId?: string | null
  relatedLayawayId?: string | null
}

export async function sendSms(args: SendSmsArgs): Promise<SendSmsResult> {
  const body = withComplianceFooter(args.body)

  return runTwilioSend({
    channel: 'sms',
    log: {
      tenant_id: args.tenantId,
      customer_id: args.customerId ?? null,
      related_loan_id: args.relatedLoanId ?? null,
      related_repair_ticket_id: args.relatedRepairTicketId ?? null,
      related_layaway_id: args.relatedLayawayId ?? null,
      kind: args.kind,
      to_address: args.to,
      body_rendered: body,
    },
    prepare: async () => {
      const creds = await resolveTwilioCreds(args.tenantId)
      if (!creds.accountSid || !creds.authToken) {
        return {
          ok: false,
          reason: 'missing_creds',
          error: 'Twilio account credentials not configured for this tenant',
        }
      }
      const from = creds.smsFrom
      const messagingServiceSid = creds.messagingServiceSid
      if (!from && !messagingServiceSid) {
        return {
          ok: false,
          reason: 'missing_from',
          error: 'Neither twilio_sms_from nor twilio_messaging_service_sid is set',
        }
      }

      const form = new URLSearchParams()
      form.set('To', args.to)
      form.set('Body', body)
      if (messagingServiceSid) {
        form.set('MessagingServiceSid', messagingServiceSid)
      } else if (from) {
        form.set('From', from)
      }

      return { ok: true, accountSid: creds.accountSid, authToken: creds.authToken, form }
    },
  })
}

/** Resolve per-tenant Twilio creds. Auth token comes from the Vault. */
export async function resolveTwilioCreds(tenantId: string): Promise<{
  accountSid: string | null
  authToken: string | null
  smsFrom: string | null
  whatsappFrom: string | null
  messagingServiceSid: string | null
}> {
  const admin = createAdminClient()
  const [{ data }, authToken] = await Promise.all([
    admin
      .from('settings')
      .select(
        'twilio_account_sid, twilio_phone_number, twilio_whatsapp_number, twilio_messaging_service_sid, twilio_sms_from, twilio_whatsapp_from',
      )
      .eq('tenant_id', tenantId)
      .maybeSingle<SettingsCommsColumns>(),
    getTenantSecret(tenantId, 'twilio_auth_token'),
  ])

  const row = data ?? null
  return {
    accountSid: row?.twilio_account_sid ?? null,
    authToken,
    smsFrom: row?.twilio_sms_from ?? row?.twilio_phone_number ?? null,
    whatsappFrom: row?.twilio_whatsapp_from ?? row?.twilio_whatsapp_number ?? null,
    messagingServiceSid: row?.twilio_messaging_service_sid ?? null,
  }
}
