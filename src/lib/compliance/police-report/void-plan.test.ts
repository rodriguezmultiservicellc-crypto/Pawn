import { describe, expect, it } from 'vitest'
import { planPoliceExport } from './void-plan'

const row = (id: string, source_id: string, event_type: string) => ({ id, source_id, event_type })

describe('planPoliceExport', () => {
  it('reports ordinary intakes and buys', () => {
    const p = planPoliceExport([row('1', 'A', 'pawn_intake'), row('2', 'B', 'buy_outright')])
    expect(p.report.map((r) => r.id)).toEqual(['1', '2'])
    expect(p.withheld).toEqual([])
    expect(p.notices).toEqual([])
  })

  it('withholds a ticket voided before it was reported, intake and void both', () => {
    const p = planPoliceExport([
      row('1', 'A', 'pawn_intake'),
      row('2', 'B', 'pawn_intake'),
      row('3', 'A', 'pawn_void'),
    ])
    expect(p.report.map((r) => r.id)).toEqual(['2'])
    expect(p.withheld.map((r) => r.id)).toEqual(['1', '3'])
    expect(p.notices).toEqual([])
  })

  it('a void of a ticket reported earlier is a notice, not a file row', () => {
    const p = planPoliceExport([row('9', 'A', 'pawn_void'), row('2', 'B', 'pawn_intake')])
    expect(p.report.map((r) => r.id)).toEqual(['2'])
    expect(p.notices.map((r) => r.id)).toEqual(['9'])
  })

  it('nothing to do', () => {
    expect(planPoliceExport([])).toEqual({ report: [], withheld: [], notices: [] })
  })
})
