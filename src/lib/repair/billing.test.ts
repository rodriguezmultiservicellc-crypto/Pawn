import { describe, expect, it } from 'vitest'
import { repairProfit, timeByTechnician } from './billing'

describe('timeByTechnician', () => {
  const now = Date.parse('2026-11-27T18:00:00Z')
  it('adds each technician\'s sessions, a running one up to now, most time first', () => {
    const rows = timeByTechnician(
      [
        { technician_id: 'a', started_at: '2026-11-27T10:00:00Z', stopped_at: '2026-11-27T10:30:00Z' },
        { technician_id: 'b', started_at: '2026-11-27T11:00:00Z', stopped_at: '2026-11-27T13:00:00Z' },
        { technician_id: 'a', started_at: '2026-11-27T17:00:00Z', stopped_at: null },
      ],
      now,
    )
    expect(rows).toEqual([
      { technician_id: 'b', ms: 2 * 3_600_000, running: false },
      { technician_id: 'a', ms: 1.5 * 3_600_000, running: true },
    ])
  })
  it('no sessions = no rows', () => {
    expect(timeByTechnician([], now)).toEqual([])
  })
})

const noLabor = { laborHours: 0, laborRate: null }

describe('repairProfit', () => {
  it('a closed ticket counts deposit + paid against the parts', () => {
    // RT-000011 from the screen: quote 60, paid 60, parts 125 + 250.
    const p = repairProfit({ quote: 60, deposit: 0, paid: 60, partsCost: 375, closed: true, ...noLabor })
    expect(p).toMatchObject({ final: true, revenue: 60, partsCost: 375, laborCost: null, profit: -315 })
    expect(p.margin).toBeCloseTo(-5.25)
  })

  it('a closed ticket uses what came in, not the quote', () => {
    const p = repairProfit({ quote: 100, deposit: 20, paid: 70, partsCost: 30, closed: true, ...noLabor })
    expect(p.revenue).toBe(90)
    expect(p.profit).toBe(60)
  })

  it('an open ticket is figured on its quote', () => {
    const p = repairProfit({ quote: 150, deposit: 50, paid: 0, partsCost: 40, closed: false, ...noLabor })
    expect(p).toMatchObject({ final: false, revenue: 150, profit: 110 })
    expect(p.margin).toBeCloseTo(110 / 150)
  })

  it('an open ticket with no quote falls back to what came in', () => {
    const p = repairProfit({ quote: null, deposit: 25, paid: 0, partsCost: 10, closed: false, ...noLabor })
    expect(p.revenue).toBe(25)
    expect(p.profit).toBe(15)
  })

  it('no revenue = no margin', () => {
    const p = repairProfit({ quote: null, deposit: 0, paid: 0, partsCost: 12.5, closed: false, ...noLabor })
    expect(p.profit).toBe(-12.5)
    expect(p.margin).toBeNull()
  })

  it('labor = timer hours x the shop rate, taken off the profit', () => {
    const p = repairProfit({
      quote: 200, deposit: 0, paid: 200, partsCost: 30, closed: true,
      laborHours: 1.5, laborRate: '40.0000',
    })
    expect(p.laborCost).toBe(60)
    expect(p.profit).toBe(110)
  })

  it('a rate of 0 is set (labor 0), not missing', () => {
    const p = repairProfit({ quote: 50, deposit: 0, paid: 50, partsCost: 0, closed: true, laborHours: 3, laborRate: 0 })
    expect(p.laborCost).toBe(0)
  })
})
