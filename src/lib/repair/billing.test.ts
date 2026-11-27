import { describe, expect, it } from 'vitest'
import { repairProfit } from './billing'

describe('repairProfit', () => {
  it('a closed ticket counts deposit + paid against the parts', () => {
    // RP ticket from the screen: quote 60, paid 60, parts 125 + 250.
    const p = repairProfit({ quote: 60, deposit: 0, paid: 60, partsCost: 375, closed: true })
    expect(p).toMatchObject({ final: true, revenue: 60, partsCost: 375, profit: -315 })
    expect(p.margin).toBeCloseTo(-5.25)
  })

  it('a closed ticket uses what came in, not the quote', () => {
    const p = repairProfit({ quote: 100, deposit: 20, paid: 70, partsCost: 30, closed: true })
    expect(p.revenue).toBe(90)
    expect(p.profit).toBe(60)
  })

  it('an open ticket is figured on its quote', () => {
    const p = repairProfit({ quote: 150, deposit: 50, paid: 0, partsCost: 40, closed: false })
    expect(p).toMatchObject({ final: false, revenue: 150, profit: 110 })
    expect(p.margin).toBeCloseTo(110 / 150)
  })

  it('an open ticket with no quote falls back to what came in', () => {
    const p = repairProfit({ quote: null, deposit: 25, paid: 0, partsCost: 10, closed: false })
    expect(p.revenue).toBe(25)
    expect(p.profit).toBe(15)
  })

  it('no revenue = no margin', () => {
    const p = repairProfit({ quote: null, deposit: 0, paid: 0, partsCost: 12.5, closed: false })
    expect(p.profit).toBe(-12.5)
    expect(p.margin).toBeNull()
  })
})
