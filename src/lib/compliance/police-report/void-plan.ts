/**
 * What one export run does with each unexported compliance_log row, once
 * voided tickets are in the log (patches/0108, 0111).
 *
 * The LeadsOnline files xPawn sent (Dropbox\pawn police) never held a voided
 * ticket back: it went out once with <void>Y</void>. So:
 *   - a ticket voided BEFORE it was reported: its intake and its void are
 *     both unexported -> ONE ticket in the file, voided; both rows stamped
 *     'reported_void'.
 *   - a ticket voided AFTER it was reported: only the void is unexported ->
 *     the ticket goes again, voided ('void_notice'). The caller loads the
 *     intake row (the ticket's own date and data) for it.
 *   - everything else goes in as reported ('reported').
 *
 * Pure.
 */

export type PlanRow = {
  id: string
  source_id: string
  event_type: string
}

export type ExportOutcome = 'reported' | 'reported_void' | 'void_notice'

export type ExportPlan<R extends PlanRow> = {
  /** Tickets to write, from their intake rows. */
  send: Array<{ row: R; voided: boolean }>
  /** Voids of tickets reported in an earlier file: send the ticket again,
   *  voided, from its intake row (which the caller loads). */
  resendVoided: R[]
  /** Every row this run covers, with what became of it. */
  stamps: Array<{ id: string; outcome: ExportOutcome }>
}

const INTAKES = new Set(['pawn_intake', 'buy_outright'])

export function planPoliceExport<R extends PlanRow>(rows: ReadonlyArray<R>): ExportPlan<R> {
  const voided = new Set(rows.filter((r) => r.event_type === 'pawn_void').map((r) => r.source_id))
  const intakeHere = new Set(rows.filter((r) => r.event_type === 'pawn_intake').map((r) => r.source_id))

  const plan: ExportPlan<R> = { send: [], resendVoided: [], stamps: [] }
  for (const r of rows) {
    if (r.event_type === 'pawn_void') {
      if (intakeHere.has(r.source_id)) {
        plan.stamps.push({ id: r.id, outcome: 'reported_void' })
      } else {
        plan.resendVoided.push(r)
        plan.stamps.push({ id: r.id, outcome: 'void_notice' })
      }
    } else if (INTAKES.has(r.event_type)) {
      const isVoided = r.event_type === 'pawn_intake' && voided.has(r.source_id)
      plan.send.push({ row: r, voided: isVoided })
      plan.stamps.push({ id: r.id, outcome: isVoided ? 'reported_void' : 'reported' })
    }
  }
  return plan
}
