import { describe, expect, it } from 'vitest'
import {
  effectiveRules,
  exceedsCap,
  forfeitEligibleDate,
  loanForfeitEligibility,
  maxMonthlyRate,
  parseJurisdictionError,
  parseRateTiers,
  parseTicketNotices,
  todayInTimezone,
  type Jurisdiction,
} from './rules'

const FL: Jurisdiction = {
  code: 'US-FL',
  name: 'Florida',
  statute: null,
  default_timezone: 'America/New_York',
  rate_cap_monthly: 0.25,
  rate_tiers: null,
  period_days: 30,
  min_charge_cap: 5,
  min_term_days: 30,
  max_term_days: 30,
  grace_days: 30,
  grace_rolls_to_business_day: true,
  buy_hold_days: 30,
  repair_abandon_days: null,
  record_retention_years: 3,
  police_reporting_required: true,
  ticket_notices: [],
  ticket_backpage: null,
  verified_on: '2026-09-18',
}

describe('maxMonthlyRate', () => {
  it('returns the flat cap when there are no tiers', () => {
    expect(maxMonthlyRate(FL, 500)).toBe(0.25)
    expect(maxMonthlyRate(FL, null)).toBe(0.25)
  })

  it('blends tiered caps across principal slices', () => {
    const tiered = {
      rate_cap_monthly: null,
      rate_tiers: [
        { up_to: 80, rate: 0.025 },
        { up_to: 225, rate: 0.02 },
        { up_to: null, rate: 0.015 },
      ],
    }
    // 80*.025 + 145*.02 + 75*.015 = 2 + 2.9 + 1.125 = 6.025 over 300
    expect(maxMonthlyRate(tiered, 300)).toBeCloseTo(6.025 / 300, 10)
    expect(maxMonthlyRate(tiered, 50)).toBe(0.025)
    expect(maxMonthlyRate(tiered, null)).toBe(0.025)
  })

  it('returns null without a jurisdiction', () => {
    expect(maxMonthlyRate(null, 100)).toBeNull()
  })
})

describe('exceedsCap', () => {
  it('tolerates 4dp float slack', () => {
    expect(exceedsCap(0.25, 0.25)).toBe(false)
    expect(exceedsCap(0.25004, 0.25)).toBe(false)
    expect(exceedsCap(0.2501, 0.25)).toBe(true)
    expect(exceedsCap(0.9, null)).toBe(false)
  })
})

describe('forfeitEligibleDate (mirrors loan_forfeit_eligible_date in SQL)', () => {
  it('weekday last day → next day', () => {
    // Mon 2026-09-07 + 30 = Wed 2026-10-07
    expect(forfeitEligibleDate('2026-09-07', 30, true)).toBe('2026-10-08')
  })
  it('Saturday last day rolls to Monday', () => {
    // Thu 2026-09-10 + 30 = Sat 2026-10-10 → Mon 10-12 → eligible Tue
    expect(forfeitEligibleDate('2026-09-10', 30, true)).toBe('2026-10-13')
  })
  it('Sunday last day rolls to Monday', () => {
    // Fri 2026-09-11 + 30 = Sun 2026-10-11 → Mon 10-12 → eligible Tue
    expect(forfeitEligibleDate('2026-09-11', 30, true)).toBe('2026-10-13')
  })
  it('no roll when the jurisdiction does not require it', () => {
    expect(forfeitEligibleDate('2026-09-10', 30, false)).toBe('2026-10-11')
  })
  it('matches live DB results for existing loans', () => {
    expect(forfeitEligibleDate('2026-05-28', 30, true)).toBe('2026-06-30')
    expect(forfeitEligibleDate('2026-06-06', 30, true)).toBe('2026-07-07')
  })
})

describe('effectiveRules', () => {
  it('floors tenant settings at statutory minimums', () => {
    const r = effectiveRules({
      jurisdiction: FL,
      timezone: null,
      graceSetting: 10,
      buyHoldSetting: 45,
      repairAbandonSetting: 90,
    })
    expect(r.graceDays).toBe(30)
    expect(r.buyHoldDays).toBe(45)
    expect(r.repairAbandonDays).toBe(90)
    expect(r.retentionYears).toBe(3)
    expect(r.timezone).toBe('America/New_York')
  })

  it('works without a jurisdiction', () => {
    const r = effectiveRules({
      jurisdiction: null,
      timezone: 'America/Chicago',
      graceSetting: null,
      buyHoldSetting: 15,
      repairAbandonSetting: null,
    })
    expect(r.graceDays).toBe(0)
    expect(r.buyHoldDays).toBe(15)
    expect(r.timezone).toBe('America/Chicago')
  })
})

describe('loanForfeitEligibility', () => {
  const rules = effectiveRules({
    jurisdiction: FL,
    timezone: null,
    graceSetting: null,
    buyHoldSetting: null,
    repairAbandonSetting: null,
  })
  it('is not eligible on the last redemption day', () => {
    const r = loanForfeitEligibility(rules, '2026-09-07', '2026-10-07')
    expect(r.eligible).toBe(false)
    expect(r.lastRedemptionDate).toBe('2026-10-07')
  })
  it('is eligible the day after', () => {
    expect(loanForfeitEligibility(rules, '2026-09-07', '2026-10-08').eligible).toBe(true)
  })
})

describe('todayInTimezone', () => {
  it('evaluates the date in the tenant timezone, not UTC', () => {
    // 2026-09-19 01:30 UTC = 2026-09-18 21:30 in New York
    const now = new Date(Date.UTC(2026, 8, 19, 1, 30))
    expect(todayInTimezone('America/New_York', now)).toBe('2026-09-18')
    expect(todayInTimezone('UTC', now)).toBe('2026-09-19')
  })
})

describe('JSON parsing', () => {
  it('parses tiers and rejects malformed input', () => {
    expect(parseRateTiers([{ up_to: 100, rate: 0.03 }, { up_to: null, rate: 0.02 }])).toEqual([
      { up_to: 100, rate: 0.03 },
      { up_to: null, rate: 0.02 },
    ])
    expect(parseRateTiers([{ rate: 'x' }])).toBeNull()
    expect(parseRateTiers(null)).toBeNull()
  })
  it('keeps notices with English text only', () => {
    expect(
      parseTicketNotices([
        { bold: true, en: 'A', es: 'B' },
        { bold: false, en: '', es: 'x' },
        'junk',
      ]),
    ).toEqual([{ bold: true, en: 'A', es: 'B' }])
  })
})

describe('parseJurisdictionError', () => {
  it('extracts code + value from trigger messages', () => {
    expect(parseJurisdictionError('jurisdiction_rate_cap:0.2500')).toEqual({
      code: 'jurisdiction_rate_cap',
      value: '0.2500',
    })
    expect(parseJurisdictionError('forfeit_not_eligible_until:2026-10-08')).toEqual({
      code: 'forfeit_not_eligible_until',
      value: '2026-10-08',
    })
    expect(parseJurisdictionError('buy_hold_cannot_shorten')).toEqual({
      code: 'buy_hold_cannot_shorten',
      value: '',
    })
    expect(parseJurisdictionError('duplicate key')).toBeNull()
  })
})
