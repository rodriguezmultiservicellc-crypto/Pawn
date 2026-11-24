/**
 * Voiding ONE payment on a pawn ticket — what it undoes, decided in one pure
 * place so the server action and the ticket page agree (and it can be tested
 * without a database).
 *
 * A payment is never edited or deleted. Voiding it writes a REVERSAL row —
 * the same money, negative, pointing at the payment (loan_events.
 * reverses_event_id, patches/0104). For what the customer owes, both rows
 * are then ignored (lib/pawn/math.liveEvents): the payment never happened.
 *
 * What comes back with it:
 *   - the due date, if the payment moved it — to where it was before;
 *   - the ticket itself, if the payment paid it off — it is open again.
 *
 * What can be voided:
 *   - only the LAST payment on the ticket. Each payment's interest, split
 *     and due date were figured on top of the ones before it; taking one out
 *     of the middle would leave the later ones standing on nothing. To undo
 *     an older payment, void the newer ones first.
 *   - not a payment brought over from the old system (it was reported there),
 *   - not a payment the customer made online (the card is refunded in
 *     Stripe; a row here would not give the money back),
 *   - not once free time was given after it (the gift was counted from the
 *     date this payment set),
 *   - not on a ticket that was forfeited or voided.
 *
 * The database checks the reversal row again (trigger in patches/0104).
 */

import { addDaysIso, toMoney } from '@/lib/pawn/math'
import type { LoanEventType, LoanStatus, PaymentMethod } from '@/types/database-aliases'

type Money = number | string | null

export type VoidEvent = {
  id: string
  event_type: LoanEventType
  occurred_at: string
  amount: Money
  principal_paid: Money
  interest_paid: Money
  fees_paid: Money
  interest_waived: Money
  payment_method: PaymentMethod | null
  new_due_date: string | null
  previous_due_date: string | null
  reverses_event_id: string | null
  legacy_ref: string | null
  stripe_session_id: string | null
}

export type VoidRefusal =
  | 'not_found'
  | 'not_a_payment'
  | 'already_voided'
  | 'imported'
  | 'online'
  | 'not_latest'
  | 'free_time_after'
  | 'loan_closed'

export type PaymentVoidPlan =
  | {
      ok: true
      /** The row that voids it: the payment's money, negated. */
      reversal: {
        amount: number
        principal_paid: number
        interest_paid: number
        fees_paid: number
        payment_method: PaymentMethod | null
      }
      /** The due date to put back; null when this payment did not move it. */
      restoreDueDate: string | null
      /** The payment had paid the ticket off: it is open again. */
      reopens: boolean
      /** The ticket's status once the payment is gone. */
      newStatus: 'active' | 'extended' | 'partial_paid'
    }
  | { ok: false; reason: VoidRefusal }

const n = toMoney
const neg = (v: Money): number => {
  const x = n(v)
  return x === 0 ? 0 : -x
}
const hasMoney = (e: VoidEvent): boolean =>
  n(e.principal_paid) !== 0 || n(e.interest_paid) !== 0 || n(e.fees_paid) !== 0

export function planPaymentVoid(args: {
  loan: { status: LoanStatus; due_date: string; issue_date: string; term_days: number }
  events: ReadonlyArray<VoidEvent>
  eventId: string
}): PaymentVoidPlan {
  const { loan } = args
  const events = [...args.events].sort(
    (a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at),
  )
  const at = events.findIndex((e) => e.id === args.eventId)
  if (at < 0) return { ok: false, reason: 'not_found' }
  const pay = events[at]
  if (pay.event_type !== 'payment' || pay.reverses_event_id) {
    return { ok: false, reason: 'not_a_payment' }
  }
  const voided = new Set<string>()
  for (const e of events) if (e.reverses_event_id) voided.add(e.reverses_event_id)
  if (voided.has(pay.id)) return { ok: false, reason: 'already_voided' }
  if (pay.legacy_ref) return { ok: false, reason: 'imported' }
  if (pay.stripe_session_id) return { ok: false, reason: 'online' }
  if (loan.status === 'forfeited' || loan.status === 'voided') {
    return { ok: false, reason: 'loan_closed' }
  }

  const isLive = (e: VoidEvent) => !e.reverses_event_id && !voided.has(e.id)
  const later = events.slice(at + 1)
  for (const e of later) {
    if (e.event_type === 'forfeiture' || e.event_type === 'void') {
      return { ok: false, reason: 'loan_closed' }
    }
    // A later payment that still stands — at the counter, or online (an
    // online payoff is a 'redemption' row that carries the money itself).
    if (isLive(e) && hasMoney(e)) return { ok: false, reason: 'not_latest' }
    if (isLive(e) && n(e.interest_waived) > 0) {
      return { ok: false, reason: 'free_time_after' }
    }
  }

  // What this payment brought with it: the rows written right behind it, up
  // to the next payment row of any kind.
  let ownMove: VoidEvent | null = null
  let ownRedemption = false
  for (const e of later) {
    if (e.event_type === 'payment') break
    if (e.event_type === 'extension' && e.new_due_date && n(e.interest_waived) === 0 && !ownMove) {
      ownMove = e
    }
    if (e.event_type === 'redemption' && !hasMoney(e)) ownRedemption = true
  }

  // A ticket that is closed, but not by this payment: nothing to reopen here.
  if (loan.status === 'redeemed' && !ownRedemption) {
    return { ok: false, reason: 'loan_closed' }
  }

  // The moves of the due date made before this payment, newest last.
  const earlierMoves = events.slice(0, at).filter((e) => e.event_type === 'extension' && e.new_due_date)

  let restoreDueDate: string | null = null
  if (ownMove) {
    // The due date must still be the one this payment set; otherwise
    // something later moved it and this is not the last word on the ticket.
    if (loan.due_date !== ownMove.new_due_date) return { ok: false, reason: 'not_latest' }
    const before =
      ownMove.previous_due_date ??
      (earlierMoves.length
        ? earlierMoves[earlierMoves.length - 1].new_due_date
        : addDaysIso(loan.issue_date, loan.term_days))
    if (before && before !== loan.due_date) restoreDueDate = before
  }

  const otherPaymentStands = events.some(
    (e) => e.id !== pay.id && e.event_type === 'payment' && isLive(e) && hasMoney(e),
  )
  const newStatus = earlierMoves.length > 0 ? 'extended' : otherPaymentStands ? 'partial_paid' : 'active'

  return {
    ok: true,
    reversal: {
      amount: neg(pay.amount ?? n(pay.principal_paid) + n(pay.interest_paid) + n(pay.fees_paid)),
      principal_paid: neg(pay.principal_paid),
      interest_paid: neg(pay.interest_paid),
      fees_paid: neg(pay.fees_paid),
      payment_method: pay.payment_method,
    },
    restoreDueDate,
    reopens: loan.status === 'redeemed',
    newStatus,
  }
}

/**
 * The payment a manager may void right now: the last one that still stands,
 * if the rules above allow it. Null when there is none.
 */
export function voidablePaymentId(args: {
  loan: { status: LoanStatus; due_date: string; issue_date: string; term_days: number }
  events: ReadonlyArray<VoidEvent>
}): string | null {
  const voided = new Set<string>()
  for (const e of args.events) if (e.reverses_event_id) voided.add(e.reverses_event_id)
  const last = [...args.events]
    .filter((e) => e.event_type === 'payment' && !e.reverses_event_id && !voided.has(e.id))
    .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))[0]
  if (!last) return null
  return planPaymentVoid({ ...args, eventId: last.id }).ok ? last.id : null
}

/**
 * The rows of a ticket's log that no longer stand: a voided payment, and
 * what it brought with it (its move of the due date, its redemption) —
 * everything between it and the next payment row. The rows that DO the
 * voiding are not in the set, nor is the row that put the due date back.
 */
export function undoneEventIds<
  T extends {
    id: string
    event_type: string
    occurred_at: string
    reverses_event_id: string | null
    interest_waived: Money
    new_due_date: string | null
    previous_due_date: string | null
  },
>(events: ReadonlyArray<T>): Set<string> {
  const voided = new Set<string>()
  for (const e of events) if (e.reverses_event_id) voided.add(e.reverses_event_id)
  const undone = new Set<string>(voided)
  if (voided.size === 0) return undone
  const ordered = [...events].sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at))
  let behindVoided = false
  for (const e of ordered) {
    if (e.event_type === 'payment') {
      // A reversal row is a payment row too; it changes nothing here.
      if (!e.reverses_event_id) behindVoided = voided.has(e.id)
      continue
    }
    if (!behindVoided) continue
    const putBack =
      e.previous_due_date != null && e.new_due_date != null && e.new_due_date < e.previous_due_date
    const ownMove = e.event_type === 'extension' && n(e.interest_waived) === 0 && !putBack
    if (ownMove || e.event_type === 'redemption') undone.add(e.id)
  }
  return undone
}
