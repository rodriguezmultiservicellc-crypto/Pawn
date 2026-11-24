import { describe, expect, it } from 'vitest'
import { planPoliceExport } from './void-plan'

const row = (id: string, source_id: string, event_type: string) => ({ id, source_id, event_type })

describe('planPoliceExport', () => {
  it('reports ordinary intakes and buys', () => {
    const p = planPoliceExport([row('1', 'A', 'pawn_intake'), row('2', 'B', 'buy_outright')])
    expect(p.send.map((t) => [t.row.id, t.voided])).toEqual([['1', false], ['2', false]])
    expect(p.stamps).toEqual([
      { id: '1', outcome: 'reported' },
      { id: '2', outcome: 'reported' },
    ])
    expect(p.resendVoided).toEqual([])
  })

  it('a ticket voided before it was reported goes once, voided (as xPawn sent them)', () => {
    const p = planPoliceExport([row('1', 'A', 'pawn_intake'), row('2', 'B', 'pawn_intake'), row('3', 'A', 'pawn_void')])
    expect(p.send.map((t) => [t.row.id, t.voided])).toEqual([['1', true], ['2', false]])
    expect(p.stamps).toContainEqual({ id: '1', outcome: 'reported_void' })
    expect(p.stamps).toContainEqual({ id: '3', outcome: 'reported_void' })
    expect(p.resendVoided).toEqual([])
  })

  it('a void of a ticket reported earlier sends that ticket again, voided', () => {
    const p = planPoliceExport([row('9', 'A', 'pawn_void'), row('2', 'B', 'pawn_intake')])
    expect(p.send.map((t) => t.row.id)).toEqual(['2'])
    expect(p.resendVoided.map((r) => r.id)).toEqual(['9'])
    expect(p.stamps).toContainEqual({ id: '9', outcome: 'void_notice' })
  })

  it('nothing to do', () => {
    expect(planPoliceExport([])).toEqual({ send: [], resendVoided: [], stamps: [] })
  })
})
