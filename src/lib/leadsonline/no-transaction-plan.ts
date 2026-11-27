/**
 * Which days to send LeadsOnline as "no transactions" (patches/0124). Pure.
 *
 * A day goes when ALL of these hold:
 *   - it is over in the shop's timezone (before the shop's today);
 *   - it is on or after `startDay` — the first day Sol Pawn got a ticket
 *     accepted in that environment (before it, another program may have
 *     reported that day's tickets);
 *   - it is within the last `lookbackDays` days (a missed night is caught up,
 *     not the whole history);
 *   - the shop wrote no pawn and no buy that day;
 *   - it was not already accepted.
 */

import { addDaysIso } from '@/lib/pawn/math'

export const NO_TRANSACTION_LOOKBACK_DAYS = 14

export function planNoTransactionDays(args: {
  /** The shop's today, YYYY-MM-DD. */
  today: string
  startDay: string | null
  /** Days (YYYY-MM-DD, shop time) with at least one pawn or buy. */
  ticketDays: ReadonlySet<string>
  /** Days already accepted by LeadsOnline in this environment. */
  doneDays: ReadonlySet<string>
  lookbackDays?: number
}): string[] {
  if (!args.startDay) return []
  const earliest = addDaysIso(args.today, -(args.lookbackDays ?? NO_TRANSACTION_LOOKBACK_DAYS))
  let day = args.startDay > earliest ? args.startDay : earliest
  const out: string[] = []
  while (day < args.today) {
    if (!args.ticketDays.has(day) && !args.doneDays.has(day)) out.push(day)
    day = addDaysIso(day, 1)
  }
  return out
}
