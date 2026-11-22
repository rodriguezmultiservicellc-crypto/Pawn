/**
 * Layaway terms (patches/0093) — a shop's saved layaway plans. Pure: the
 * edit-form schema and the rule that turns a plan into the values a new
 * layaway is opened with.
 *
 * A plan stores shares and day counts ("20% down, first payment in 7 days,
 * paid off in 90"). The New layaway dialog applies it to the sale total and
 * to today's date in the shop's timezone, and sends the same fields a clerk
 * types under "Custom" — so the layaway itself is saved exactly as before.
 */

import { z } from 'zod'
import { r2 } from '@/lib/money'
import { addDaysIso } from '@/lib/pawn/math'
import type { LayawayScheduleKind } from '@/types/database-aliases'

export const LAYAWAY_TERMS_EDIT_ROLES = ['owner', 'chain_admin', 'manager'] as const
export const LAYAWAY_TERMS_MAX = 12

export const LAYAWAY_SCHEDULE_KINDS = ['weekly', 'biweekly', 'monthly', 'custom'] as const

export type LayawayTerm = {
  id: string
  name: string
  schedule_kind: LayawayScheduleKind
  /** Fraction of the total: 0.2 = 20%. */
  down_payment_pct: number
  first_payment_days: number
  term_days: number
  /** Fraction: 0.1 = 10%. */
  cancellation_fee_pct: number
  is_default: boolean
  is_active: boolean
}

/** A percent typed by a person (0–100, two decimals) → the stored fraction. */
const percentAsFraction = z.coerce
  .number()
  .min(0)
  .max(100)
  .finite()
  .transform((p) => Math.round(p * 100) / 10000)

/** Same bounds as the 0093 CHECKs. */
export const layawayTermInputSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    schedule_kind: z.enum(LAYAWAY_SCHEDULE_KINDS),
    down_payment_percent: percentAsFraction,
    first_payment_days: z.coerce.number().int().min(1).max(366),
    term_days: z.coerce.number().int().min(1).max(1096),
    cancellation_fee_percent: percentAsFraction,
    is_active: z.boolean(),
  })
  .refine((v) => v.first_payment_days <= v.term_days, { path: ['first_payment_days'] })

export type LayawayTermInput = z.input<typeof layawayTermInputSchema>

export type AppliedLayawayTerm = {
  schedule_kind: LayawayScheduleKind
  /** Minimum down payment for this total, to the cent. */
  down_payment_min: number
  first_payment_due: string
  final_due_date: string
  cancellation_fee_pct: number
}

/**
 * The values a layaway opens with under a plan.
 * @param today the shop's date today, 'YYYY-MM-DD' (todayInTimezone).
 */
export function applyLayawayTerm(
  term: Pick<
    LayawayTerm,
    'schedule_kind' | 'down_payment_pct' | 'first_payment_days' | 'term_days' | 'cancellation_fee_pct'
  >,
  total: number,
  today: string,
): AppliedLayawayTerm {
  return {
    schedule_kind: term.schedule_kind,
    down_payment_min: r2(Math.max(0, total) * term.down_payment_pct),
    first_payment_due: addDaysIso(today, term.first_payment_days),
    final_due_date: addDaysIso(today, term.term_days),
    cancellation_fee_pct: term.cancellation_fee_pct,
  }
}

/** The plan the dialog opens on: the default, else the first active one, else none (Custom). */
export function initialLayawayTerm<T extends Pick<LayawayTerm, 'is_default'>>(terms: T[]): T | null {
  return terms.find((t) => t.is_default) ?? terms[0] ?? null
}
