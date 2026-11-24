/**
 * The ticket page's event log shows a payment and the due-date move written
 * right behind it as ONE entry ("Payment + Extension"): the clerk took one
 * payment that moved the date. The rows stay two in loan_events; this only
 * decides what the log shows.
 *
 * Same "belongs to the payment" rule as the receipt (FOLLOW_UP_MS, used by
 * payment-receipt.ts): an extension within that window after a payment, with
 * nothing between them. Never folded in: the move a payment VOID writes (it
 * follows the reversal row, and moves the date back), free time (it has
 * interest_waived), and anything following a reversal.
 *
 * Pure.
 */

/** An extension / redemption this soon after a payment belongs to it (the
 *  receipt reads its new due date / redemption by the same window). */
export const FOLLOW_UP_MS = 120_000

export type LogEvent = {
  id: string
  event_type: string
  reverses_event_id: string | null
  occurred_at: string
  new_due_date: string | null
  previous_due_date: string | null
  interest_waived: number
  notes: string | null
}

export type MergedLogEvent<E extends LogEvent> = E & {
  /** The due date this payment's own extension moved the ticket to. */
  moved_to: string | null
  /** The extension's note, when it says something the payment's does not. */
  move_notes: string | null
}

export function mergePaymentMoves<E extends LogEvent>(events: ReadonlyArray<E>): MergedLogEvent<E>[] {
  const asc = events
    .slice()
    .sort((a, b) => (a.occurred_at < b.occurred_at ? -1 : a.occurred_at > b.occurred_at ? 1 : 0))

  const moveOf = new Map<string, E>() // payment id -> its extension
  for (let i = 0; i + 1 < asc.length; i++) {
    const pay = asc[i]
    const next = asc[i + 1]
    if (pay.event_type !== 'payment' || pay.reverses_event_id != null) continue
    if (next.event_type !== 'extension' || next.reverses_event_id != null) continue
    if (next.interest_waived > 0 || !next.new_due_date) continue
    if (next.previous_due_date && next.new_due_date < next.previous_due_date) continue
    if (Date.parse(next.occurred_at) - Date.parse(pay.occurred_at) > FOLLOW_UP_MS) continue
    moveOf.set(pay.id, next)
  }
  const folded = new Set([...moveOf.values()].map((e) => e.id))

  return events
    .filter((e) => !folded.has(e.id))
    .map((e) => {
      const move = moveOf.get(e.id)
      const moveNotes = move?.notes?.trim() || null
      return {
        ...e,
        moved_to: move?.new_due_date ?? null,
        move_notes: moveNotes && moveNotes !== (e.notes?.trim() || null) ? moveNotes : null,
      }
    })
}
