/**
 * Shared core for outbound Twilio sends (SMS + WhatsApp).
 *
 * Both rails — sendSms (sms.ts) and sendWhatsApp (whatsapp.ts) — funnel
 * through runTwilioSend() so the queued-log insert, NODE_ENV=test
 * short-circuit, the Twilio REST POST, 429/error handling, and the
 * markSent/markFailed message_log writes exist exactly once.
 *
 * Each per-rail wrapper keeps its own credential resolution (which Vault
 * secret + which `settings` column the From comes from) and channel
 * framing (whatsapp: prefix, ContentSid, the SMS TCPA footer) by passing a
 * `prepare()` callback that either returns a ready-to-POST request or a
 * pre-send failure.
 *
 * Behavior contract (unchanged from the pre-refactor sms.ts/whatsapp.ts):
 *   1. Always insert a message_log row up-front with status='queued'. We
 *      want a record even if the provider call hangs / panics.
 *   2. On provider success, UPDATE the row to status='sent' + provider_id +
 *      sent_at. On failure, UPDATE to status='failed' + error_text.
 *   3. NEVER throw on provider failure — return a tagged result.
 *   4. In NODE_ENV='test', no-op: insert a 'queued' row and return ok=false
 *      with reason='skipped_test'. Keeps build/test/CI green credential-free.
 */

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import type { MessageLogInsert } from '@/types/database-aliases'

const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01'

export type Channel = 'sms' | 'whatsapp'

export type SendReason =
  | 'missing_creds'
  | 'missing_from'
  | 'rate_limited'
  | 'opted_out'
  | 'provider_error'
  | 'skipped_test'
  | 'missing_content_sid'

export type RunTwilioSendResult =
  | {
      ok: true
      messageLogId: string
      providerId: string
    }
  | {
      ok: false
      messageLogId: string | null
      reason: SendReason
      error: string | null
    }

/** A resolved, ready-to-POST Twilio request, or a pre-send failure. */
export type PreparedRequest =
  | {
      ok: true
      accountSid: string
      authToken: string
      form: URLSearchParams
    }
  | {
      ok: false
      reason: SendReason
      error: string
    }

export type RunTwilioSendArgs = {
  channel: Channel
  /** The queued message_log row. core stamps `channel` + `status`. */
  log: Omit<MessageLogInsert, 'channel' | 'status'>
  /** Resolve creds + build the Twilio form, or return a pre-send failure. */
  prepare: () => Promise<PreparedRequest>
}

export async function runTwilioSend(
  args: RunTwilioSendArgs,
): Promise<RunTwilioSendResult> {
  const admin = createAdminClient()
  const tag = `[twilio.${args.channel}]`

  // 1. Insert queued log row first.
  const { data: logRow, error: logErr } = await admin
    .from('message_log')
    .insert({ ...args.log, channel: args.channel, status: 'queued' })
    .select('id')
    .single()

  if (logErr || !logRow?.id) {
    console.error(`${tag} failed to insert queued log row`, logErr?.message)
    return {
      ok: false,
      messageLogId: null,
      reason: 'provider_error',
      error: logErr?.message ?? 'message_log insert failed',
    }
  }

  // 2. Test short-circuit.
  if (process.env.NODE_ENV === 'test') {
    return { ok: false, messageLogId: logRow.id, reason: 'skipped_test', error: null }
  }

  // 3. Resolve creds + build request.
  const prepared = await args.prepare()
  if (!prepared.ok) {
    await markFailed(args.channel, logRow.id, prepared.reason, prepared.error)
    return {
      ok: false,
      messageLogId: logRow.id,
      reason: prepared.reason,
      error: prepared.error,
    }
  }

  // 4. POST to Twilio.
  const auth =
    'Basic ' + Buffer.from(`${prepared.accountSid}:${prepared.authToken}`).toString('base64')
  const url = `${TWILIO_API_BASE}/Accounts/${encodeURIComponent(prepared.accountSid)}/Messages.json`

  let providerId: string | null = null
  let providerError: string | null = null
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: prepared.form.toString(),
    })

    const json = (await res.json().catch(() => null)) as
      | { sid?: string; status?: string; error_code?: number; message?: string }
      | null

    if (res.status === 429) {
      await markFailed(args.channel, logRow.id, 'rate_limited', json?.message ?? 'Twilio rate limited')
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
    await markSent(args.channel, logRow.id, providerId)
    return { ok: true, messageLogId: logRow.id, providerId }
  }

  await markFailed(args.channel, logRow.id, 'provider_error', providerError)
  return {
    ok: false,
    messageLogId: logRow.id,
    reason: 'provider_error',
    error: providerError,
  }
}

async function markSent(channel: Channel, logId: string, providerId: string) {
  const admin = createAdminClient()
  const { error } = await admin
    .from('message_log')
    .update({
      status: 'sent',
      provider_id: providerId,
      sent_at: new Date().toISOString(),
    })
    .eq('id', logId)
  if (error) console.error(`[twilio.${channel}] markSent failed`, error.message)
}

async function markFailed(
  channel: Channel,
  logId: string,
  reason: string,
  errorText: string | null,
) {
  const admin = createAdminClient()
  const { error } = await admin
    .from('message_log')
    .update({
      status: reason === 'opted_out' ? 'opted_out' : 'failed',
      error_text: errorText,
    })
    .eq('id', logId)
  if (error) console.error(`[twilio.${channel}] markFailed failed`, error.message)
}
