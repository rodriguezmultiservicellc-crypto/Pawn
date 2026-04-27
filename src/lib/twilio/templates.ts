/**
 * WhatsApp approved-template registry.
 *
 * Twilio + Meta require an approved template per (kind, language) before any
 * outbound WhatsApp message can be sent on a production WABA number. Each
 * approved template gets a Content SID (HX...) which is what we POST to the
 * Twilio Messages API as `ContentSid`.
 *
 * Source of truth is per tenant: `message_templates.whatsapp_content_sid`.
 * Owners populate it via the Settings → Communications UI AFTER they finish
 * the Twilio approval workflow. Until populated, sendWhatsApp() falls back
 * to a freeform body — that only works in the Twilio sandbox or inside an
 * already-open 24h conversation window.
 *
 * This file used to be where we hard-coded SIDs. We deliberately do NOT
 * hard-code them anymore — every tenant has their own WABA + their own SIDs.
 * The helper here just resolves the active SID for a given (tenant, kind,
 * language) from message_templates.
 */

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Language, MessageKind, MessageTemplateRow } from '@/types/database-aliases'

/**
 * Resolve the WhatsApp Content SID for a given tenant + kind + language.
 * Returns null if the tenant has not populated one yet — callers fall back
 * to freeform body, which only delivers in the Twilio sandbox.
 */
export async function resolveWhatsAppContentSid(args: {
  tenantId: string
  kind: MessageKind
  language: Language
}): Promise<string | null> {
  const admin = createAdminClient()
  const { data } = await (admin as unknown as {
    from: (t: 'message_templates') => {
      select: (s: string) => {
        eq: (k: string, v: string) => {
          eq: (k: string, v: string) => {
            eq: (k: string, v: string) => {
              eq: (k: string, v: string) => {
                is: (k: string, v: null) => {
                  maybeSingle: () => Promise<{
                    data: Pick<MessageTemplateRow, 'whatsapp_content_sid'> | null
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
    .select('whatsapp_content_sid')
    .eq('tenant_id', args.tenantId)
    .eq('kind', args.kind)
    .eq('language', args.language)
    .eq('channel', 'whatsapp')
    .is('deleted_at', null)
    .maybeSingle()

  return data?.whatsapp_content_sid ?? null
}
