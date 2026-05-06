'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/supabase/ctx'
import { requireOwner, requireStaff } from '@/lib/supabase/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { setTenantSecret } from '@/lib/secrets/vault'
import { logAudit } from '@/lib/audit'
import { dispatchMessage } from '@/lib/comms/dispatch'
import { renderEmailTemplate, renderTemplate } from '@/lib/comms/render'
import { sendSms } from '@/lib/twilio/sms'
import { sendWhatsApp } from '@/lib/twilio/whatsapp'
import { sendEmail } from '@/lib/email/send'
import {
  commsSettingsSchema,
  manualSendSchema,
  messageTemplateEditSchema,
  messageTemplateToggleSchema,
  testSendSchema,
} from '@/lib/validations/communications'
import type {
  MessageChannel,
  MessageKind,
  MessageTemplateRow,
  MessageTemplateUpdate,
} from '@/types/database-aliases'

export type ActionResult = { ok: true } | { error: string; fieldErrors?: Record<string, string> }

// ── Settings (creds) ────────────────────────────────────────────────────────

export async function updateCommsSettingsAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  await requireOwner(ctx.tenantId)

  const raw: Record<string, FormDataEntryValue | null> = {}
  for (const k of [
    'twilio_account_sid',
    'twilio_auth_token',
    'twilio_sms_from',
    'twilio_whatsapp_from',
    'twilio_messaging_service_sid',
    'resend_api_key',
    'resend_from_email',
    'resend_from_name',
  ]) {
    raw[k] = formData.get(k)
  }

  const parsed = commsSettingsSchema.safeParse(raw)
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.')
      if (path) fieldErrors[path] = issue.message
    }
    return { error: 'invalid_input', fieldErrors }
  }
  const v = parsed.data

  // Auth-token semantics: if the form submitted '' for the token / api key,
  // we treat that as "no change". Submitting the literal string '__CLEAR__'
  // clears it. Submitting any other value updates it.
  const admin = createAdminClient()
  const update: Record<string, string | null> = {
    twilio_account_sid: v.twilio_account_sid,
    twilio_sms_from: v.twilio_sms_from,
    twilio_whatsapp_from: v.twilio_whatsapp_from,
    twilio_messaging_service_sid: v.twilio_messaging_service_sid,
    resend_from_email: v.resend_from_email,
    resend_from_name: v.resend_from_name,
  }
  const tokenRaw = formData.get('twilio_auth_token')
  if (typeof tokenRaw === 'string') {
    if (tokenRaw === '__CLEAR__') update.twilio_auth_token = null
    else if (tokenRaw.trim() !== '') update.twilio_auth_token = tokenRaw.trim()
  }
  const keyRaw = formData.get('resend_api_key')
  if (typeof keyRaw === 'string') {
    if (keyRaw === '__CLEAR__') update.resend_api_key = null
    else if (keyRaw.trim() !== '') update.resend_api_key = keyRaw.trim()
  }

  // Cast through unknown — the new comms columns from 0010 aren't in the
  // generated Database type yet (operator regenerates after applying the
  // migration). The runtime shape is correct.
  const { error } = await (admin as unknown as {
    from: (t: 'settings') => {
      update: (v: Record<string, unknown>) => {
        eq: (k: string, v: string) => Promise<{ error: { message: string } | null }>
      }
    }
  })
    .from('settings')
    .update(update)
    .eq('tenant_id', ctx.tenantId)
  if (error) return { error: error.message }

  // Dual-write secrets to vault. Plaintext column update above keeps
  // pre-migration read paths working; this writes the same value into
  // tenant_secrets so vault-first read paths see the latest. Once all
  // read paths flip to vault-only and migration 0034 drops the
  // plaintext columns, this dual-write becomes the single write.
  if ('twilio_auth_token' in update) {
    await setTenantSecret(ctx.tenantId, 'twilio_auth_token', update.twilio_auth_token ?? null)
  }
  if ('resend_api_key' in update) {
    await setTenantSecret(ctx.tenantId, 'resend_api_key', update.resend_api_key ?? null)
  }

  await logAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: 'update',
    tableName: 'settings',
    recordId: ctx.tenantId,
    changes: {
      // Don't log secrets — log the keys that changed only.
      changed_fields: Object.keys(update).filter(
        (k) => k !== 'twilio_auth_token' && k !== 'resend_api_key',
      ),
      twilio_auth_token_changed: 'twilio_auth_token' in update,
      resend_api_key_changed: 'resend_api_key' in update,
    },
  })

  revalidatePath('/settings/communications')
  return { ok: true }
}

// ── Message templates ───────────────────────────────────────────────────────

export async function updateMessageTemplateAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  await requireOwner(ctx.tenantId)

  const parsed = messageTemplateEditSchema.safeParse({
    id: formData.get('id'),
    subject: formData.get('subject'),
    body: formData.get('body'),
    whatsapp_content_sid: formData.get('whatsapp_content_sid'),
    is_enabled: formData.get('is_enabled') ?? false,
  })
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.')
      if (path) fieldErrors[path] = issue.message
    }
    return { error: 'invalid_input', fieldErrors }
  }
  const v = parsed.data

  const admin = createAdminClient()
  const update: MessageTemplateUpdate = {
    subject: v.subject,
    body: v.body,
    whatsapp_content_sid: v.whatsapp_content_sid,
    is_enabled: v.is_enabled,
    updated_by: ctx.userId,
  }

  const { data: prior, error: priorErr } = await (admin as unknown as {
    from: (t: 'message_templates') => {
      select: (s: string) => {
        eq: (k: string, v: string) => {
          eq: (k: string, v: string) => {
            maybeSingle: () => Promise<{
              data: MessageTemplateRow | null
              error: { message: string } | null
            }>
          }
        }
      }
    }
  })
    .from('message_templates')
    .select(
      'id, tenant_id, kind, language, channel, subject, body, whatsapp_content_sid, is_enabled, created_at, updated_at, deleted_at, created_by, updated_by',
    )
    .eq('id', v.id)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle()
  if (priorErr || !prior) return { error: 'not_found' }

  const { error } = await (admin as unknown as {
    from: (t: 'message_templates') => {
      update: (v: MessageTemplateUpdate) => {
        eq: (k: string, v: string) => {
          eq: (k: string, v: string) => Promise<{ error: { message: string } | null }>
        }
      }
    }
  })
    .from('message_templates')
    .update(update)
    .eq('id', v.id)
    .eq('tenant_id', ctx.tenantId)
  if (error) return { error: error.message }

  await logAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: 'update',
    tableName: 'message_templates',
    recordId: v.id,
    changes: {
      kind: prior.kind,
      language: prior.language,
      channel: prior.channel,
      subject_changed: prior.subject !== v.subject,
      body_changed: prior.body !== v.body,
      is_enabled: v.is_enabled,
    },
  })

  revalidatePath('/settings/communications')
  return { ok: true }
}

export async function toggleMessageTemplateAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  await requireOwner(ctx.tenantId)

  const parsed = messageTemplateToggleSchema.safeParse({
    id: formData.get('id'),
    is_enabled: formData.get('is_enabled') ?? false,
  })
  if (!parsed.success) return { error: 'invalid_input' }

  const admin = createAdminClient()
  const { error } = await (admin as unknown as {
    from: (t: 'message_templates') => {
      update: (v: MessageTemplateUpdate) => {
        eq: (k: string, v: string) => {
          eq: (k: string, v: string) => Promise<{ error: { message: string } | null }>
        }
      }
    }
  })
    .from('message_templates')
    .update({ is_enabled: parsed.data.is_enabled, updated_by: ctx.userId })
    .eq('id', parsed.data.id)
    .eq('tenant_id', ctx.tenantId)
  if (error) return { error: error.message }

  await logAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: 'update',
    tableName: 'message_templates',
    recordId: parsed.data.id,
    changes: { is_enabled: parsed.data.is_enabled },
  })
  revalidatePath('/settings/communications')
  return { ok: true }
}

// ── Test send ───────────────────────────────────────────────────────────────

export async function testSendTemplateAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  await requireOwner(ctx.tenantId)

  const parsed = testSendSchema.safeParse({
    template_id: formData.get('template_id'),
    to: formData.get('to'),
  })
  if (!parsed.success) return { error: 'invalid_input' }

  const admin = createAdminClient()
  const { data: tpl } = await (admin as unknown as {
    from: (t: 'message_templates') => {
      select: (s: string) => {
        eq: (k: string, v: string) => {
          eq: (k: string, v: string) => {
            maybeSingle: () => Promise<{ data: MessageTemplateRow | null }>
          }
        }
      }
    }
  })
    .from('message_templates')
    .select(
      'id, tenant_id, kind, language, channel, subject, body, whatsapp_content_sid, is_enabled, created_at, updated_at, deleted_at, created_by, updated_by',
    )
    .eq('id', parsed.data.template_id)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle()

  if (!tpl) return { error: 'template_not_found' }

  const { data: tenant } = await admin
    .from('tenants')
    .select('name, dba')
    .eq('id', ctx.tenantId)
    .maybeSingle<{ name: string; dba: string | null }>()

  const sampleVars = {
    shop_name: tenant?.dba ?? tenant?.name ?? 'Shop',
    customer_first_name: 'Sample',
    customer_last_name: 'Customer',
    ticket_number: 'PT-000123',
    due_date: new Date().toISOString().slice(0, 10),
    amount: '$100.00',
    portal_link: process.env.NEXT_PUBLIC_APP_URL ?? '',
    body: 'Test message body.',
  }

  if (tpl.channel === 'sms') {
    const body = renderTemplate(tpl.body, sampleVars)
    const res = await sendSms({
      tenantId: ctx.tenantId,
      to: parsed.data.to,
      body,
      kind: tpl.kind as MessageKind,
    })
    if (!res.ok) return { error: res.error ?? res.reason }
  } else if (tpl.channel === 'whatsapp') {
    const body = renderTemplate(tpl.body, sampleVars)
    const res = await sendWhatsApp({
      tenantId: ctx.tenantId,
      to: parsed.data.to,
      contentSid: tpl.whatsapp_content_sid,
      contentVars: stringifyVars(sampleVars),
      body,
      kind: tpl.kind as MessageKind,
    })
    if (!res.ok) return { error: res.error ?? res.reason }
  } else {
    const rendered = renderEmailTemplate({
      subject: tpl.subject,
      body: tpl.body,
      vars: sampleVars,
    })
    const res = await sendEmail({
      tenantId: ctx.tenantId,
      to: parsed.data.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      kind: tpl.kind as MessageKind,
    })
    if (!res.ok) return { error: res.error ?? res.reason }
  }

  await logAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: 'add_note',
    tableName: 'message_templates',
    recordId: parsed.data.template_id,
    changes: { test_send_to: parsed.data.to, channel: tpl.channel },
  })
  return { ok: true }
}

// ── Manual send (used by SendReminderDialog) ────────────────────────────────

export async function manualSendAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  await requireStaff(ctx.tenantId)

  const parsed = manualSendSchema.safeParse({
    customer_id: formData.get('customer_id'),
    kind: formData.get('kind'),
    channel: formData.get('channel') || null,
    related_loan_id: formData.get('related_loan_id') || null,
    related_repair_ticket_id: formData.get('related_repair_ticket_id') || null,
    related_layaway_id: formData.get('related_layaway_id') || null,
  })
  if (!parsed.success) return { error: 'invalid_input' }

  const v = parsed.data

  // Build minimal vars — page-specific data (ticket #, payoff, balance) is
  // resolved on the calling page and injected via formData fields where
  // supplied. Manual sends are a "best-effort" surface: we hydrate what we
  // can from the related row, fall back to placeholders.
  const vars = await buildVarsForRelated(ctx.tenantId, {
    loanId: v.related_loan_id ?? null,
    repairId: v.related_repair_ticket_id ?? null,
    layawayId: v.related_layaway_id ?? null,
  })

  const res = await dispatchMessage({
    tenantId: ctx.tenantId,
    customerId: v.customer_id,
    kind: v.kind as MessageKind,
    channelOverride: v.channel ? (v.channel as MessageChannel) : undefined,
    vars,
    related: {
      loanId: v.related_loan_id ?? null,
      repairTicketId: v.related_repair_ticket_id ?? null,
      layawayId: v.related_layaway_id ?? null,
    },
  })

  if (!res.ok) return { error: res.error ?? res.reason }

  await logAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: 'add_note',
    tableName: 'message_log',
    recordId: res.messageLogId,
    changes: {
      manual_send: true,
      kind: v.kind,
      channel: res.channel,
      customer_id: v.customer_id,
    },
  })
  return { ok: true }
}

async function buildVarsForRelated(
  _tenantId: string,
  related: { loanId: string | null; repairId: string | null; layawayId: string | null },
): Promise<Record<string, string>> {
  const admin = createAdminClient()
  const vars: Record<string, string> = {}

  if (related.loanId) {
    const { data } = await admin
      .from('loans')
      .select('ticket_number, due_date')
      .eq('id', related.loanId)
      .maybeSingle()
    if (data) {
      if (data.ticket_number) vars.ticket_number = data.ticket_number
      if (data.due_date) vars.due_date = data.due_date
    }
  }
  if (related.repairId) {
    const { data } = await admin
      .from('repair_tickets')
      .select('ticket_number, balance_due, promised_date')
      .eq('id', related.repairId)
      .maybeSingle()
    if (data) {
      if (data.ticket_number) vars.ticket_number = data.ticket_number
      if (data.balance_due != null) vars.amount = formatUsd(Number(data.balance_due))
      if (data.promised_date) vars.due_date = data.promised_date
    }
  }
  if (related.layawayId) {
    const { data } = await admin
      .from('layaways')
      .select('layaway_number, first_payment_due, balance_remaining')
      .eq('id', related.layawayId)
      .maybeSingle()
    if (data) {
      if (data.layaway_number) vars.ticket_number = data.layaway_number
      if (data.first_payment_due) vars.due_date = data.first_payment_due
      if (data.balance_remaining != null) vars.amount = formatUsd(Number(data.balance_remaining))
    }
  }
  return vars
}

function stringifyVars(vars: Record<string, string | number | null | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(vars)) {
    if (v == null) continue
    out[k] = String(v)
  }
  return out
}

function formatUsd(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}
