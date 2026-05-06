/**
 * Resend email — per-tenant API key + From address.
 *
 * Resend's REST API is straightforward: POST /emails with {from, to, subject,
 * html, text}. We don't pull in the SDK to keep the bundle light and to
 * avoid the SDK's runtime-only dependencies.
 *
 * Behavior contract mirrors twilio/sms.ts: insert message_log queued first,
 * call provider, update to sent/failed. Never throw.
 */

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { getTenantSecret } from '@/lib/secrets/vault'
import type {
  MessageKind,
  MessageLogInsert,
  SettingsCommsColumns,
} from '@/types/database-aliases'

const RESEND_API_BASE = 'https://api.resend.com'

export type SendEmailResult =
  | {
      ok: true
      messageLogId: string
      providerId: string
    }
  | {
      ok: false
      messageLogId: string | null
      reason:
        | 'missing_creds'
        | 'missing_from'
        | 'rate_limited'
        | 'provider_error'
        | 'skipped_test'
      error: string | null
    }

export type SendEmailArgs = {
  tenantId: string
  to: string
  subject: string
  html: string
  text: string
  kind: MessageKind
  customerId?: string | null
  relatedLoanId?: string | null
  relatedRepairTicketId?: string | null
  relatedLayawayId?: string | null
}

export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const admin = createAdminClient()

  // Always log against the rendered text body — keeps message_log readable.
  const queueInsert: MessageLogInsert = {
    tenant_id: args.tenantId,
    customer_id: args.customerId ?? null,
    related_loan_id: args.relatedLoanId ?? null,
    related_repair_ticket_id: args.relatedRepairTicketId ?? null,
    related_layaway_id: args.relatedLayawayId ?? null,
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
    console.error('[email.resend] failed to insert queued log row', logErr?.message)
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

  const creds = await resolveResendCreds(args.tenantId)
  if (!creds.apiKey) {
    await markFailed(logRow.id, 'missing_creds', 'Resend API key not configured')
    return {
      ok: false,
      messageLogId: logRow.id,
      reason: 'missing_creds',
      error: 'Resend not configured',
    }
  }
  if (!creds.fromEmail) {
    await markFailed(logRow.id, 'missing_from', 'Resend From email not configured')
    return {
      ok: false,
      messageLogId: logRow.id,
      reason: 'missing_from',
      error: 'Email From not configured',
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
      | { id?: string; message?: string; name?: string }
      | null

    if (res.status === 429) {
      await markFailed(logRow.id, 'rate_limited', json?.message ?? 'Resend rate limited')
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
    providerError = err instanceof Error ? err.message : 'Resend fetch failed'
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

export async function resolveResendCreds(tenantId: string): Promise<{
  apiKey: string | null
  fromEmail: string | null
  fromName: string | null
}> {
  const admin = createAdminClient()
  const [{ data }, apiKey] = await Promise.all([
    admin
      .from('settings')
      .select('email_from, resend_from_email, resend_from_name')
      .eq('tenant_id', tenantId)
      .maybeSingle<SettingsCommsColumns>(),
    getTenantSecret(tenantId, 'resend_api_key'),
  ])

  const row = data ?? null
  return {
    apiKey,
    fromEmail: row?.resend_from_email ?? row?.email_from ?? null,
    fromName: row?.resend_from_name ?? null,
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
  if (error) console.error('[email.resend] markSent failed', error.message)
}

async function markFailed(logId: string, _reason: string, errorText: string | null) {
  const admin = createAdminClient()
  const { error } = await admin
    .from('message_log')
    .update({
      status: 'failed',
      error_text: errorText,
    })
    .eq('id', logId)
  if (error) console.error('[email.resend] markFailed failed', error.message)
}
