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
 * Status semantics + log writes mirror sms.ts.
 */

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveTwilioCreds } from './sms'
import type {
  MessageKind,
  MessageLogInsert,
} from '@/types/database-aliases'

const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01'

export type SendWhatsAppResult =
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
        | 'opted_out'
        | 'provider_error'
        | 'skipped_test'
        | 'missing_content_sid'
      error: string | null
    }

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
  const admin = createAdminClient()

  const queueInsert: MessageLogInsert = {
    tenant_id: args.tenantId,
    customer_id: args.customerId ?? null,
    related_loan_id: args.relatedLoanId ?? null,
    related_repair_ticket_id: args.relatedRepairTicketId ?? null,
    related_layaway_id: args.relatedLayawayId ?? null,
    channel: 'whatsapp',
    kind: args.kind,
    status: 'queued',
    to_address: args.to,
    body_rendered: args.body,
  }

  const { data: logRow, error: logErr } = await (admin as unknown as {
    from: (
      t: 'message_log',
    ) => {
      insert: (v: MessageLogInsert) => {
        select: (s: string) => {
          single: () => Promise<{
            data: { id: string } | null
            error: { message: string } | null
          }>
        }
      }
    }
  })
    .from('message_log')
    .insert(queueInsert)
    .select('id')
    .single()

  if (logErr || !logRow?.id) {
    console.error('[twilio.whatsapp] failed to insert queued log row', logErr?.message)
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

  const creds = await resolveTwilioCreds(args.tenantId)
  if (!creds.accountSid || !creds.authToken) {
    await markFailed(logRow.id, 'missing_creds', 'Twilio account credentials not configured')
    return {
      ok: false,
      messageLogId: logRow.id,
      reason: 'missing_creds',
      error: 'Twilio not configured',
    }
  }
  const from = creds.whatsappFrom
  if (!from) {
    await markFailed(logRow.id, 'missing_from', 'twilio_whatsapp_from is not set')
    return {
      ok: false,
      messageLogId: logRow.id,
      reason: 'missing_from',
      error: 'WhatsApp sender not configured',
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
    // Freeform fallback — only valid against the Twilio WhatsApp sandbox or
    // within an open 24h conversation window. Production sends MUST set
    // contentSid (operator: populate after WhatsApp Business approval).
    form.set('Body', args.body)
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

async function markSent(logId: string, providerId: string) {
  const admin = createAdminClient()
  const { error } = await (admin as unknown as {
    from: (t: 'message_log') => {
      update: (v: Record<string, unknown>) => {
        eq: (k: string, v: string) => Promise<{ error: { message: string } | null }>
      }
    }
  })
    .from('message_log')
    .update({
      status: 'sent',
      provider_id: providerId,
      sent_at: new Date().toISOString(),
    })
    .eq('id', logId)
  if (error) console.error('[twilio.whatsapp] markSent failed', error.message)
}

async function markFailed(logId: string, reason: string, errorText: string | null) {
  const admin = createAdminClient()
  const { error } = await (admin as unknown as {
    from: (t: 'message_log') => {
      update: (v: Record<string, unknown>) => {
        eq: (k: string, v: string) => Promise<{ error: { message: string } | null }>
      }
    }
  })
    .from('message_log')
    .update({
      status: reason === 'opted_out' ? 'opted_out' : 'failed',
      error_text: errorText,
    })
    .eq('id', logId)
  if (error) console.error('[twilio.whatsapp] markFailed failed', error.message)
}
