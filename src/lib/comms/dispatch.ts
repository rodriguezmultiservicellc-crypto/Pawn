/**
 * High-level message dispatcher.
 *
 * Resolves customer language + comm preference, looks up the correct
 * tenant-editable template (kind, language, channel), renders it, and
 * routes to the right provider helper. Inserts to message_log are
 * performed by the provider helpers themselves — dispatch.ts is the
 * thin business-logic layer above them.
 *
 * Channel selection precedence (when no explicit channel passed):
 *   1. customer.comm_preference  (sms | whatsapp | email | none)
 *   2. fallback to email if email available, else sms
 *   3. 'none' returns ok=false reason='opted_out_preference' WITHOUT
 *      writing a message_log row — preference 'none' means no contact.
 *
 * Always-bilingual rule: customer.language picks template language; if
 * the matching language template doesn't exist, fall back to English.
 */

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendSms } from '@/lib/twilio/sms'
import { sendWhatsApp } from '@/lib/twilio/whatsapp'
import { sendEmail } from '@/lib/email/send'
import { renderTemplate, renderEmailTemplate, type RenderVars } from './render'
import type {
  CommPreference,
  Language,
  MessageChannel,
  MessageKind,
  MessageTemplateRow,
} from '@/types/database-aliases'

export type DispatchResult =
  | {
      ok: true
      messageLogId: string
      providerId: string
      channel: MessageChannel
    }
  | {
      ok: false
      reason:
        | 'customer_not_found'
        | 'no_destination'
        | 'opted_out_preference'
        | 'template_missing'
        | 'template_disabled'
        | 'provider_failed'
        | 'tenant_not_found'
      error: string | null
      messageLogId: string | null
    }

export type DispatchArgs = {
  tenantId: string
  customerId: string
  kind: MessageKind
  vars?: RenderVars
  /** Override the customer's preferred channel for this send (test, manual). */
  channelOverride?: MessageChannel
  /** Override destination address (test sends from the Settings UI). */
  toOverride?: string
  related?: {
    loanId?: string | null
    repairTicketId?: string | null
    layawayId?: string | null
  }
}

export async function dispatchMessage(
  args: DispatchArgs,
): Promise<DispatchResult> {
  const admin = createAdminClient()

  // 1. Resolve customer (lang, comm preference, contact info).
  const { data: customer } = await admin
    .from('customers')
    .select('id, first_name, last_name, phone, email, language, comm_preference')
    .eq('id', args.customerId)
    .maybeSingle<{
      id: string
      first_name: string
      last_name: string
      phone: string | null
      email: string | null
      language: 'en' | 'es' | null
      comm_preference: CommPreference | null
    }>()

  if (!customer) {
    return { ok: false, reason: 'customer_not_found', error: null, messageLogId: null }
  }

  // 2. Resolve tenant (shop name for {{shop_name}} variable).
  const { data: tenant } = await admin
    .from('tenants')
    .select('name, dba')
    .eq('id', args.tenantId)
    .maybeSingle<{ name: string; dba: string | null }>()
  if (!tenant) {
    return { ok: false, reason: 'tenant_not_found', error: null, messageLogId: null }
  }

  // 3. Pick channel.
  let channel: MessageChannel
  if (args.channelOverride) {
    channel = args.channelOverride
  } else {
    const pref = customer.comm_preference ?? 'sms'
    if (pref === 'none') {
      return {
        ok: false,
        reason: 'opted_out_preference',
        error: 'Customer comm_preference is none',
        messageLogId: null,
      }
    }
    channel = pref as MessageChannel
  }

  // 4. Pick destination address.
  const to =
    args.toOverride ??
    (channel === 'email' ? customer.email : customer.phone) ??
    null
  if (!to) {
    return {
      ok: false,
      reason: 'no_destination',
      error: `Customer has no ${channel === 'email' ? 'email' : 'phone'} on file`,
      messageLogId: null,
    }
  }

  // 5. Pick template (preferred lang then fallback to en).
  const language: Language = (customer.language ?? 'en') as Language
  const template = await loadTemplate(args.tenantId, args.kind, language, channel)
  if (!template) {
    return {
      ok: false,
      reason: 'template_missing',
      error: `No ${channel} template for ${args.kind} in ${language} (and no en fallback)`,
      messageLogId: null,
    }
  }
  if (!template.is_enabled) {
    return {
      ok: false,
      reason: 'template_disabled',
      error: null,
      messageLogId: null,
    }
  }

  // 6. Build vars (template-supplied + system-supplied).
  const vars: RenderVars = {
    shop_name: tenant.dba ?? tenant.name,
    customer_first_name: customer.first_name,
    customer_last_name: customer.last_name,
    ...(args.vars ?? {}),
  }

  // 7. Render + dispatch.
  if (channel === 'sms') {
    const body = renderTemplate(template.body, vars)
    const res = await sendSms({
      tenantId: args.tenantId,
      to,
      body,
      kind: args.kind,
      customerId: args.customerId,
      relatedLoanId: args.related?.loanId ?? null,
      relatedRepairTicketId: args.related?.repairTicketId ?? null,
      relatedLayawayId: args.related?.layawayId ?? null,
    })
    return res.ok
      ? { ok: true, messageLogId: res.messageLogId, providerId: res.providerId, channel: 'sms' }
      : {
          ok: false,
          reason: 'provider_failed',
          error: res.error,
          messageLogId: res.messageLogId,
        }
  }

  if (channel === 'whatsapp') {
    const body = renderTemplate(template.body, vars)
    const res = await sendWhatsApp({
      tenantId: args.tenantId,
      to,
      contentSid: template.whatsapp_content_sid,
      contentVars: stringifyVars(vars),
      body,
      kind: args.kind,
      customerId: args.customerId,
      relatedLoanId: args.related?.loanId ?? null,
      relatedRepairTicketId: args.related?.repairTicketId ?? null,
      relatedLayawayId: args.related?.layawayId ?? null,
    })
    return res.ok
      ? { ok: true, messageLogId: res.messageLogId, providerId: res.providerId, channel: 'whatsapp' }
      : {
          ok: false,
          reason: 'provider_failed',
          error: res.error,
          messageLogId: res.messageLogId,
        }
  }

  // email
  const rendered = renderEmailTemplate({
    subject: template.subject,
    body: template.body,
    vars,
  })
  const res = await sendEmail({
    tenantId: args.tenantId,
    to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    kind: args.kind,
    customerId: args.customerId,
    relatedLoanId: args.related?.loanId ?? null,
    relatedRepairTicketId: args.related?.repairTicketId ?? null,
    relatedLayawayId: args.related?.layawayId ?? null,
  })
  return res.ok
    ? { ok: true, messageLogId: res.messageLogId, providerId: res.providerId, channel: 'email' }
    : {
        ok: false,
        reason: 'provider_failed',
        error: res.error,
        messageLogId: res.messageLogId,
      }
}

/** Load a template with language fallback to 'en'. */
async function loadTemplate(
  tenantId: string,
  kind: MessageKind,
  language: Language,
  channel: MessageChannel,
): Promise<MessageTemplateRow | null> {
  const admin = createAdminClient()
  const fetchOne = async (lang: Language): Promise<MessageTemplateRow | null> => {
    const { data } = await (admin as unknown as {
      from: (t: 'message_templates') => {
        select: (s: string) => {
          eq: (k: string, v: string) => {
            eq: (k: string, v: string) => {
              eq: (k: string, v: string) => {
                eq: (k: string, v: string) => {
                  is: (k: string, v: null) => {
                    maybeSingle: () => Promise<{
                      data: MessageTemplateRow | null
                    }>
                  }
                }
              }
            }
          }
        }
      }
    })
      .from('message_templates')
      .select(
        'id, tenant_id, kind, language, channel, subject, body, whatsapp_content_sid, is_enabled, created_at, updated_at, deleted_at, created_by, updated_by',
      )
      .eq('tenant_id', tenantId)
      .eq('kind', kind)
      .eq('language', lang)
      .eq('channel', channel)
      .is('deleted_at', null)
      .maybeSingle()
    return data ?? null
  }

  const exact = await fetchOne(language)
  if (exact) return exact
  if (language !== 'en') return fetchOne('en')
  return null
}

function stringifyVars(vars: RenderVars): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(vars)) {
    if (v == null) continue
    out[k] = String(v)
  }
  return out
}
