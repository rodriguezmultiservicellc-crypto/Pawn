import { describe, expect, it } from 'vitest'
import { fractionToPercent } from '@/lib/format/money'
import {
  applyLayawayTerm,
  initialLayawayTerm,
  layawayTermInputSchema,
} from './layaway-terms'

const plan = {
  schedule_kind: 'weekly' as const,
  down_payment_pct: 0.2,
  first_payment_days: 7,
  term_days: 90,
  cancellation_fee_pct: 0.1,
}

describe('applyLayawayTerm', () => {
  it('turns shares and day counts into amounts and dates', () => {
    expect(applyLayawayTerm(plan, 200, '2026-11-22')).toEqual({
      schedule_kind: 'weekly',
      down_payment_min: 40,
      first_payment_due: '2026-11-29',
      final_due_date: '2027-02-20',
      cancellation_fee_pct: 0.1,
    })
  })

  it('rounds the down payment to the cent', () => {
    expect(applyLayawayTerm({ ...plan, down_payment_pct: 0.3333 }, 199.99, '2026-11-22').down_payment_min).toBe(66.66)
  })

  it('crosses month and leap-day boundaries', () => {
    const r = applyLayawayTerm({ ...plan, first_payment_days: 30, term_days: 60 }, 100, '2028-01-31')
    expect(r.first_payment_due).toBe('2028-03-01')
    expect(r.final_due_date).toBe('2028-03-31')
  })

  it('asks for nothing down when the plan has no down payment', () => {
    expect(applyLayawayTerm({ ...plan, down_payment_pct: 0 }, 500, '2026-11-22').down_payment_min).toBe(0)
  })
})

describe('initialLayawayTerm', () => {
  it('prefers the default, then the first plan, then none', () => {
    const a = { id: 'a', is_default: false }
    const b = { id: 'b', is_default: true }
    expect(initialLayawayTerm([a, b])).toBe(b)
    expect(initialLayawayTerm([a])).toBe(a)
    expect(initialLayawayTerm([])).toBeNull()
  })
})

describe('layawayTermInputSchema', () => {
  const input = {
    name: ' 90 days ',
    schedule_kind: 'weekly',
    down_payment_percent: '20',
    first_payment_days: '7',
    term_days: '90',
    cancellation_fee_percent: '12.5',
    is_active: true,
  }

  it('stores typed percents as fractions', () => {
    const r = layawayTermInputSchema.parse(input)
    expect(r.name).toBe('90 days')
    expect(r.down_payment_percent).toBe(0.2)
    expect(r.cancellation_fee_percent).toBe(0.125)
  })

  it('refuses a first payment after the pay-off date', () => {
    expect(layawayTermInputSchema.safeParse({ ...input, first_payment_days: '91' }).success).toBe(false)
  })

  it('refuses a percent above 100 and a blank name', () => {
    expect(layawayTermInputSchema.safeParse({ ...input, down_payment_percent: '120' }).success).toBe(false)
    expect(layawayTermInputSchema.safeParse({ ...input, name: '  ' }).success).toBe(false)
  })
})

describe('fractionToPercent', () => {
  it('shows a stored fraction as a percent', () => {
    expect(fractionToPercent(0.2)).toBe('20')
    expect(fractionToPercent(0.125)).toBe('12.5')
    expect(fractionToPercent(0)).toBe('0')
  })
})
