/**
 * Report date ranges in the SHOP's day (REVIEW-2026-11-11 finding 10). Pure.
 *
 * A report for "Nov 13" means Nov 13 in the shop's timezone: a Florida sale
 * rung up at 9 PM belongs to that day, not to Nov 14 because UTC already
 * rolled over. Every report turns its date range into timestamp bounds with
 * reportBounds(), and picks its default dates from the shop's today.
 */

import { addDaysIso } from '@/lib/pawn/math'
import { dayStartInTimezone, todayInTimezone } from '@/lib/jurisdictions/rules'
import type { ReportRange } from './types'

const DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Validate a requested range, filling gaps with defaults relative to the
 * shop's today (defaultFromDays / defaultToDays are offsets, e.g. -30 and 0).
 * A reversed range is swapped rather than producing zero rows.
 */
export function buildRange(args: {
  from?: string | null
  to?: string | null
  timezone: string
  defaultFromDays?: number
  defaultToDays?: number
  now?: Date
}): ReportRange {
  const today = todayInTimezone(args.timezone, args.now)
  const from = args.from && DATE.test(args.from) ? args.from : addDaysIso(today, args.defaultFromDays ?? 0)
  const to = args.to && DATE.test(args.to) ? args.to : addDaysIso(today, args.defaultToDays ?? 0)
  return from > to
    ? { from: to, to: from, timezone: args.timezone }
    : { from, to, timezone: args.timezone }
}

/** Timestamp bounds: [start of `from`, start of the day after `to`) in the shop's zone. */
export function reportBounds(range: ReportRange): { fromIso: string; toExclusiveIso: string } {
  return {
    fromIso: dayStartInTimezone(range.from, range.timezone),
    toExclusiveIso: dayStartInTimezone(addDaysIso(range.to, 1), range.timezone),
  }
}

/** The shop's today, for "printed on" lines and as-of dates. */
export function reportToday(range: Pick<ReportRange, 'timezone'>, now?: Date): string {
  return todayInTimezone(range.timezone, now)
}
