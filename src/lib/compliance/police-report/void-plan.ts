/**
 * What one export run does with each unexported compliance_log row, once
 * voided tickets are in the log (patches/0108).
 *
 *   - A ticket voided BEFORE it was reported: its intake and its void are
 *     both unexported. Neither goes in the file ("withheld").
 *   - A ticket voided AFTER it was reported: only the void is unexported.
 *     It is a correction the shop makes with the agency ("notice").
 *   - Everything else goes in the file ("report").
 *
 * Pure. The cron stamps each group with its export_outcome.
 */

export type PlanRow = {
  id: string
  source_id: string
  event_type: string
}

export type ExportPlan<R extends PlanRow> = {
  /** Rows that go in the file. */
  report: R[]
  /** Voided before they were reported: left out of the file. */
  withheld: R[]
  /** Voids of tickets reported in an earlier file: corrections to send. */
  notices: R[]
}

export function planPoliceExport<R extends PlanRow>(rows: ReadonlyArray<R>): ExportPlan<R> {
  const voided = new Set(rows.filter((r) => r.event_type === 'pawn_void').map((r) => r.source_id))
  const intakeHere = new Set(rows.filter((r) => r.event_type === 'pawn_intake').map((r) => r.source_id))

  const plan: ExportPlan<R> = { report: [], withheld: [], notices: [] }
  for (const r of rows) {
    if (r.event_type === 'pawn_void') {
      if (intakeHere.has(r.source_id)) plan.withheld.push(r)
      else plan.notices.push(r)
    } else if (r.event_type === 'pawn_intake' && voided.has(r.source_id)) {
      plan.withheld.push(r)
    } else {
      plan.report.push(r)
    }
  }
  return plan
}
