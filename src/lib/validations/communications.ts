import { z } from 'zod'

/**
 * Communications Zod schemas — Settings (per-tenant Twilio + Resend creds),
 * message_templates editor, manual-send dialog, test-send dialog.
 */

const optionalTrimmed = z
  .preprocess(
    (v) => (typeof v === 'string' ? v.trim() : v),
    z.string().max(500).optional().nullable(),
  )
  .transform((v) => (v === '' || v == null ? null : v))

const optionalEmail = z
  .preprocess(
    (v) => (typeof v === 'string' ? v.trim() : v),
    z.string().email('invalid_email').optional().nullable(),
  )
  .transform((v) => (v === '' || v == null ? null : v))

const optionalPhone = z
  .preprocess(
    (v) => (typeof v === 'string' ? v.trim() : v),
    z
      .string()
      // Loose E.164-ish — Twilio is the real validator. We just block obvious garbage.
      .regex(/^\+?[0-9 ()\-]{6,20}$/, 'invalid_phone')
      .optional()
      .nullable(),
  )
  .transform((v) => (v === '' || v == null ? null : v))

export const messageKindSchema = z.enum([
  'loan_maturity_t7',
  'loan_maturity_t1',
  'loan_due_today',
  'loan_overdue_t1',
  'loan_overdue_t7',
  'repair_ready',
  'repair_pickup_reminder',
  'layaway_payment_due',
  'layaway_overdue',
  'layaway_completed',
  'custom',
])

export const messageChannelSchema = z.enum(['sms', 'whatsapp', 'email'])
export const messageLanguageSchema = z.enum(['en', 'es'])

/** Per-tenant comms settings form. */
export const commsSettingsSchema = z.object({
  twilio_account_sid: optionalTrimmed,
  twilio_auth_token: optionalTrimmed,
  twilio_sms_from: optionalPhone,
  twilio_whatsapp_from: optionalPhone,
  twilio_messaging_service_sid: optionalTrimmed,
  resend_api_key: optionalTrimmed,
  resend_from_email: optionalEmail,
  resend_from_name: optionalTrimmed,
})

export type CommsSettingsInput = z.infer<typeof commsSettingsSchema>

/** Edit a single message_template row. */
export const messageTemplateEditSchema = z.object({
  id: z.string().uuid(),
  subject: optionalTrimmed,
  body: z.preprocess(
    (v) => (typeof v === 'string' ? v : ''),
    z.string().min(1, 'body_required').max(4000, 'body_too_long'),
  ),
  whatsapp_content_sid: optionalTrimmed,
  is_enabled: z.preprocess(
    (v) => v === 'on' || v === 'true' || v === true,
    z.boolean(),
  ),
})

export type MessageTemplateEditInput = z.infer<typeof messageTemplateEditSchema>

/** Toggle enabled state without opening the editor. */
export const messageTemplateToggleSchema = z.object({
  id: z.string().uuid(),
  is_enabled: z.preprocess(
    (v) => v === 'on' || v === 'true' || v === true,
    z.boolean(),
  ),
})

/** Manual-send (SendReminderDialog) — pick channel + kind for one customer. */
export const manualSendSchema = z.object({
  customer_id: z.string().uuid(),
  kind: messageKindSchema,
  channel: messageChannelSchema.optional().nullable(),
  related_loan_id: z.string().uuid().optional().nullable(),
  related_repair_ticket_id: z.string().uuid().optional().nullable(),
  related_layaway_id: z.string().uuid().optional().nullable(),
})

export type ManualSendInput = z.infer<typeof manualSendSchema>

/** Test-send from the Settings UI. */
export const testSendSchema = z.object({
  template_id: z.string().uuid(),
  to: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : v),
    z.string().min(3, 'to_required').max(200),
  ),
})

export type TestSendInput = z.infer<typeof testSendSchema>
