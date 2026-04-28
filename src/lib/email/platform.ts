/**
 * Platform-level email sender. Uses the RESEND_API_KEY env var directly
 * instead of per-tenant Resend creds. Used for messages FROM RMS TO a
 * tenant (e.g. SaaS dunning), NOT tenant→customer messages.
 *
 * Logs to message_log against the recipient tenant so the operator can
 * audit what was sent. customer_id stays null because the recipient is a
 * staff user (tenant owner), not a customer record.
 */

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import type { MessageKind, MessageLogInsert } from '@/types/database-aliases'

const RESEND_API_BASE = 'https://api.resend.com'

export type SendPlatformEmailResult =
  | {
      ok: true
      messageLogId: string
      providerId: string
    }
  | {
      ok: false
      messageLogId: string | null
      reason:
        | 'missing_api_key'
        | 'missing_from'
        | 'rate_limited'
        | 'provider_error'
        | 'skipped_test'
      error: string | null
    }

export type SendPlatformEmailArgs = {
  /** Recipient's tenant — what the message_log row attaches to. */
  tenantId: string
  to: string
  subject: string
  html: string
  text: string
  kind: MessageKind
}

function platformResendCreds(): {
  apiKey: string | null
  fromEmail: string | null
  fromName: string | null
} {
  return {
    apiKey: process.env.RESEND_API_KEY ?? null,
    // Prefer a dedicated platform From address, fall back to a sane
    // default. The user must verify this domain in Resend before live
    // sends will succeed.
    fromEmail:
      process.env.RESEND_PLATFORM_FROM_EMAIL ??
      process.env.RESEND_FROM_EMAIL ??
      null,
    fromName: process.env.RESEND_PLATFORM_FROM_NAME ?? 'Pawn',
  }
}

export async function sendPlatformEmail(
  args: SendPlatformEmailArgs,
): Promise<SendPlatformEmailResult> {
  const admin = createAdminClient()

  const queueInsert: MessageLogInsert = {
    tenant_id: args.tenantId,
    customer_id: null,
    channel: 'email',
    kind: args.kind,
    status: 'queued',
    to_address: args.to,
    body_rendered: `Subject: ${args.subject}\n\n${args.text}`,
  }

  const { data: logRow, error: logErr } = await admin
    .from('message_log')
    .insert(queueInsert)
    .select('id')
    .single()

  if (logErr || !logRow?.id) {
    console.error('[email.platform] log insert failed', logErr?.message)
    return {
      ok: false,
      messageLogId: null,
      reason: 'provider_error',
      error: logErr?.message ?? 'message_log insert failed',
    }
  }

  if (process.env.NODE_ENV === 'test') {
    return {
      ok: false,
      messageLogId: logRow.id,
      reason: 'skipped_test',
      error: null,
    }
  }

  const creds = platformResendCreds()
  if (!creds.apiKey) {
    await markFailed(logRow.id, 'RESEND_API_KEY missing')
    return {
      ok: false,
      messageLogId: logRow.id,
      reason: 'missing_api_key',
      error: 'platform RESEND_API_KEY not set',
    }
  }
  if (!creds.fromEmail) {
    await markFailed(logRow.id, 'RESEND_PLATFORM_FROM_EMAIL missing')
    return {
      ok: false,
      messageLogId: logRow.id,
      reason: 'missing_from',
      error: 'platform From address not set',
    }
  }

  const fromHeader = creds.fromName
    ? `${creds.fromName} <${creds.fromEmail}>`
    : creds.fromEmail

  let providerId: string | null = null
  let providerError: string | null = null

  try {
    const res = await fetch(`${RESEND_API_BASE}/emails`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromHeader,
        to: [args.to],
        subject: args.subject,
        html: args.html,
        text: args.text,
      }),
    })

    const json = (await res.json().catch(() => null)) as
      | { id?: string; message?: string }
      | null

    if (res.status === 429) {
      await markFailed(logRow.id, json?.message ?? 'rate limited')
      return {
        ok: false,
        messageLogId: logRow.id,
        reason: 'rate_limited',
        error: json?.message ?? 'rate limited',
      }
    }
    if (!res.ok) {
      providerError = json?.message ?? `Resend HTTP ${res.status}`
    } else if (json?.id) {
      providerId = json.id
    } else {
      providerError = 'Resend response missing email ID'
    }
  } catch (err) {
    providerError = err instanceof Error ? err.message : 'fetch_failed'
  }

  if (providerId) {
    await markSent(logRow.id, providerId)
    return { ok: true, messageLogId: logRow.id, providerId }
  }

  await markFailed(logRow.id, providerError)
  return {
    ok: false,
    messageLogId: logRow.id,
    reason: 'provider_error',
    error: providerError,
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
  if (error) console.error('[email.platform] markSent failed', error.message)
}

async function markFailed(logId: string, errorText: string | null) {
  const admin = createAdminClient()
  const { error } = await admin
    .from('message_log')
    .update({ status: 'failed', error_text: errorText })
    .eq('id', logId)
  if (error) console.error('[email.platform] markFailed failed', error.message)
}
