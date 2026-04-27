import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { createAdminClient } from '@/lib/supabase/admin'
import CommunicationsContent, {
  type CommsSettingsView,
  type TemplateRowView,
} from './content'
import type {
  MessageChannel,
  MessageKind,
  MessageTemplateRow,
  SettingsCommsColumns,
} from '@/types/database-aliases'

export default async function CommunicationsSettingsPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  if (
    ctx.tenantRole !== 'owner' &&
    ctx.tenantRole !== 'chain_admin' &&
    ctx.tenantRole !== 'manager'
  ) {
    redirect('/dashboard')
  }

  const admin = createAdminClient()

  const { data: settingsRow } = await admin
    .from('settings')
    .select(
      'twilio_account_sid, twilio_auth_token, twilio_phone_number, twilio_whatsapp_number, twilio_messaging_service_sid, twilio_sms_from, twilio_whatsapp_from, resend_api_key, email_from, resend_from_email, resend_from_name',
    )
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle<SettingsCommsColumns>()

  const settings: CommsSettingsView = {
    twilio_account_sid: settingsRow?.twilio_account_sid ?? null,
    twilio_auth_token_set: !!settingsRow?.twilio_auth_token,
    twilio_sms_from:
      settingsRow?.twilio_sms_from ?? settingsRow?.twilio_phone_number ?? null,
    twilio_whatsapp_from:
      settingsRow?.twilio_whatsapp_from ?? settingsRow?.twilio_whatsapp_number ?? null,
    twilio_messaging_service_sid: settingsRow?.twilio_messaging_service_sid ?? null,
    resend_api_key_set: !!settingsRow?.resend_api_key,
    resend_from_email: settingsRow?.resend_from_email ?? settingsRow?.email_from ?? null,
    resend_from_name: settingsRow?.resend_from_name ?? null,
  }

  // Templates — read via admin (RLS allows staff but admin client is simpler
  // and doesn't change auth context). Returned grouped by kind on the client.
  const { data: templateRows } = await (admin as unknown as {
    from: (t: 'message_templates') => {
      select: (s: string) => {
        eq: (k: string, v: string) => {
          is: (k: string, v: null) => {
            order: (
              k: string,
              o: { ascending: boolean },
            ) => {
              order: (
                k: string,
                o: { ascending: boolean },
              ) => {
                order: (
                  k: string,
                  o: { ascending: boolean },
                ) => Promise<{ data: MessageTemplateRow[] | null }>
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
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .order('kind', { ascending: true })
    .order('language', { ascending: true })
    .order('channel', { ascending: true })

  const templates: TemplateRowView[] = (templateRows ?? []).map((t) => ({
    id: t.id,
    kind: t.kind as MessageKind,
    language: t.language as 'en' | 'es',
    channel: t.channel as MessageChannel,
    subject: t.subject,
    body: t.body,
    whatsapp_content_sid: t.whatsapp_content_sid,
    is_enabled: t.is_enabled,
  }))

  return (
    <CommunicationsContent settings={settings} templates={templates} />
  )
}
