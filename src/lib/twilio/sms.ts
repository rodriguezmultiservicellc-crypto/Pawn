/**
 * Twilio Programmable Messaging — SMS.
 *
 * Per-tenant credentials live in `settings` (Twilio account SID, auth token,
 * From number, optional Messaging Service SID). The send is a plain fetch
 * to the Twilio REST API — no SDK — to keep the bundle light and to avoid
 * the SDK's runtime-only dependency on Node's `crypto.createHmac` shape.
 *
 * Behavior contract (also applies to whatsapp.ts and email/send.ts):
 *   1. Always insert a message_log row up-front with status='queued'. We
 *      want a record even if the provider call hangs / panics.
 *   2. On provider success, UPDATE the row to status='sent' + provider_id +
 *      sent_at. On failure, UPDATE to status='failed' + error_text.
 *   3. NEVER throw on provider failure — return a tagged result. Callers
 *      log audit + return to the user as "failed to send" without taking
 *      down the surrounding action.
 *   4. In NODE_ENV='test', or when creds missing, no-op success: insert
 *      a 'queued' row and return ok=false with a `skipped` reason. This
 *      keeps build/test/CI green without any Twilio creds present.
 */

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { getTenantSecret } from '@/lib/secrets/vault'
import type {
  MessageKind,
  MessageLogInsert,
  SettingsCommsColumns,
} from '@/types/database-aliases'

const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01'

export type SendSmsResult =
  | {
      ok: true
      messageLogId: string
      providerId: string
    }
  | {
      ok: false
      messageLogId: string | null
      reason: 'missing_creds' | 'missing_from' | 'rate_limited' | 'opted_out' | 'provider_error' | 'skipped_test'
      error: string | null
    }

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
  const admin = createAdminClient()

  // 1. Insert queued log row first.
  const queueInsert: MessageLogInsert = {
    tenant_id: args.tenantId,
    customer_id: args.customerId ?? null,
    related_loan_id: args.relatedLoanId ?? null,
    related_repair_ticket_id: args.relatedRepairTicketId ?? null,
    related_layaway_id: args.relatedLayawayId ?? null,
    channel: 'sms',
    kind: args.kind,
    status: 'queued',
    to_address: args.to,
    body_rendered: args.body,
  }

  const { data: logRow, error: logErr } = await admin
    .from('message_log')
    .insert(queueInsert)
    .select('id')
    .single()

  if (logErr || !logRow?.id) {
    console.error('[twilio.sms] failed to insert queued log row', logErr?.message)
    return {
      ok: false,
      messageLogId: null,
      reason: 'provider_error',
      error: logErr?.message ?? 'message_log insert failed',
    }
  }

  // 2. Test / no-creds short-circuit.
  if (process.env.NODE_ENV === 'test') {
    return {
      ok: false,
      messageLogId: logRow.id,
      reason: 'skipped_test',
      error: null,
    }
  }

  // 3. Resolve creds + From.
  const creds = await resolveTwilioCreds(args.tenantId)
  if (!creds.accountSid || !creds.authToken) {
    await markFailed(logRow.id, 'missing_creds', 'Twilio account credentials not configured for this tenant')
    return {
      ok: false,
      messageLogId: logRow.id,
      reason: 'missing_creds',
      error: 'Twilio not configured',
    }
  }
  const from = creds.smsFrom
  const messagingServiceSid = creds.messagingServiceSid
  if (!from && !messagingServiceSid) {
    await markFailed(logRow.id, 'missing_from', 'Neither twilio_sms_from nor twilio_messaging_service_sid is set')
    return {
      ok: false,
      messageLogId: logRow.id,
      reason: 'missing_from',
      error: 'Twilio sender not configured',
    }
  }

  // 4. POST to Twilio.
  const form = new URLSearchParams()
  form.set('To', args.to)
  form.set('Body', args.body)
  if (messagingServiceSid) {
    form.set('MessagingServiceSid', messagingServiceSid)
  } else if (from) {
    form.set('From', from)
  }

  const auth = 'Basic ' + Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString('base64')
  const url = `${TWILIO_API_BASE}/Accounts/${encodeURIComponent(creds.accountSid)}/Messages.json`

  let providerId: string | null = null
  let providerError: string | null = null
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    })

    const json = (await res.json().catch(() => null)) as
      | { sid?: string; status?: string; error_code?: number; message?: string }
      | null

    if (res.status === 429) {
      await markFailed(logRow.id, 'rate_limited', json?.message ?? 'Twilio rate limited')
      return {
        ok: false,
        messageLogId: logRow.id,
        reason: 'rate_limited',
        error: json?.message ?? 'rate limited',
      }
    }
    if (!res.ok) {
      providerError = json?.message ?? `Twilio HTTP ${res.status}`
    } else if (json?.sid) {
      providerId = json.sid
    } else {
      providerError = 'Twilio response missing message SID'
    }
  } catch (err) {
    providerError = err instanceof Error ? err.message : 'Twilio fetch failed'
  }

  if (providerId) {
    await markSent(logRow.id, providerId)
    return { ok: true, messageLogId: logRow.id, providerId }
  }

  await markFailed(logRow.id, 'provider_error', providerError)
  return {
    ok: false,
    messageLogId: logRow.id,
    reason: 'provider_error',
    error: providerError,
  }
}

/** Resolve per-tenant Twilio creds. Auth token comes from vault. */
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
    whatsappFrom:
      row?.twilio_whatsapp_from ?? row?.twilio_whatsapp_number ?? null,
    messagingServiceSid: row?.twilio_messaging_service_sid ?? null,
  }
}

async function markSent(logId: string, providerId: string) {
  const admin = createAdminClient()
  const { error } = await admin
    .from('message_log')
    .update({
      status: 'sent',
      provider_id: providerId,
      sent_at: new Date().toISOString(),
    })
    .eq('id', logId)
  if (error) console.error('[twilio.sms] markSent failed', error.message)
}

async function markFailed(logId: string, reason: string, errorText: string | null) {
  const admin = createAdminClient()
  const { error } = await admin
    .from('message_log')
    .update({
      status: reason === 'opted_out' ? 'opted_out' : 'failed',
      error_text: errorText,
    })
    .eq('id', logId)
  if (error) console.error('[twilio.sms] markFailed failed', error.message)
}
