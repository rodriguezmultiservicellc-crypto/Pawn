import { z } from 'zod'
import { LASER_ORDER_STATUSES } from '@/lib/orocut/status'

/**
 * Laser nameplate orders (patches/0070) — form + webhook schemas. Limits
 * mirror the orocut.com order contract (spec "The order", 2026-11-09) so a
 * bad value is caught here with a translated message instead of a 400 from
 * the remote.
 */

const optionalText = (max: number) =>
  z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      z.string().trim().max(max, 'too_long').nullable().optional(),
    )
    .transform((v) => v ?? null)

const optionalNumber = (min: number, max: number) =>
  z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      z.coerce.number().min(min, 'out_of_range').max(max, 'out_of_range').finite().nullable().optional(),
    )
    .transform((v) => v ?? null)

const optionalDate = z
  .preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid_date').nullable().optional(),
  )
  .transform((v) => v ?? null)

const optionalHttpsUrl = z
  .preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z
      .string()
      .trim()
      .max(2048, 'too_long')
      .regex(/^https:\/\/\S+$/i, 'https_required')
      .nullable()
      .optional(),
  )
  .transform((v) => v ?? null)

export const laserOrderSendSchema = z.object({
  ticket_id: z.string().uuid(),
  text: z.string().trim().min(1, 'required').max(60, 'too_long'),
  text2: optionalText(60),
  style: optionalText(80),
  quantity: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? 1 : v),
    z.coerce.number().int('out_of_range').min(1, 'out_of_range').max(50, 'out_of_range'),
  ),
  metal: optionalText(40),
  thickness_mm: optionalNumber(0.1, 5),
  chain_length_in: optionalNumber(6, 36),
  height_mm: optionalNumber(2, 60),
  customer_name: optionalText(80),
  due_at: optionalDate,
  notes: optionalText(1000),
  picture_url: optionalHttpsUrl,
})

export type LaserOrderSendInput = z.infer<typeof laserOrderSendSchema>

export const laserOrderIdSchema = z.object({
  order_id: z.string().uuid(),
})

/** Webhook body: {order_id, external_id, status, reason?, details?, at}. */
export const orocutWebhookSchema = z.object({
  order_id: z.string().min(1).max(128),
  external_id: z.string().max(64).nullish(),
  status: z.enum(LASER_ORDER_STATUSES),
  reason: z.string().max(300).nullish(),
  details: z
    .object({
      width_mm: z.number().finite().optional(),
      height_mm: z.number().finite().optional(),
      minutes: z.number().finite().optional(),
      passes: z.number().finite().optional(),
    })
    .passthrough()
    .nullish(),
  by: z.string().max(80).nullish(),
  at: z.string().min(1).max(64),
})

// ── Settings (/settings/integrations/orocut) ──────────────────────────────

/**
 * Secret-field semantics shared with the other integrations:
 *   blank → undefined (no change) · '__CLEAR__' → null (delete) · text → set
 * orocut.com issues `ord_` + 40 hex for the order token and `whsec_` + 48
 * hex for the webhook signing secret (lib/licensing/orders.ts there).
 */
const secretField = (re: RegExp) =>
  z.preprocess(
    (v) => {
      if (typeof v !== 'string') return undefined
      const t = v.trim()
      if (t === '') return undefined
      if (t === '__CLEAR__') return null
      return t
    },
    z.union([z.string().regex(re, 'invalid_format'), z.null(), z.undefined()]),
  )

export const OROCUT_ORDER_TOKEN_RE = /^ord_[0-9a-f]{40}$/
export const OROCUT_WEBHOOK_SECRET_RE = /^whsec_[0-9a-f]{48}$/

/** One style name per line; blanks dropped, duplicates collapsed. */
const styleNames = z
  .string()
  .max(10_000, 'too_long')
  .transform((raw) => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const line of raw.split(/\r?\n/)) {
      const s = line.trim()
      if (!s || seen.has(s.toLowerCase())) continue
      seen.add(s.toLowerCase())
      out.push(s)
    }
    return out
  })
  .refine((arr) => arr.length <= 100, 'too_many')
  .refine((arr) => arr.every((s) => s.length <= 80), 'too_long')

export const orocutSettingsSchema = z.object({
  orocut_order_token: secretField(OROCUT_ORDER_TOKEN_RE),
  orocut_webhook_secret: secretField(OROCUT_WEBHOOK_SECRET_RE),
  orocut_style_names: styleNames,
})

export type OrocutSettingsInput = z.infer<typeof orocutSettingsSchema>
