import { describe, expect, it } from 'vitest'
import {
  AUTOMATION_DEFS,
  isDue,
  loanStepsDueToday,
  mergeAutomations,
} from './automations'

const defaults = mergeAutomations([])

describe('mergeAutomations', () => {
  it('uses code defaults when no rows exist', () => {
    expect(defaults).toHaveLength(AUTOMATION_DEFS.length)
    const t7 = defaults.find((c) => c.kind === 'loan_maturity_t7')!
    expect(t7.isEnabled).toBe(true)
    expect(t7.offsetDays).toBe(-7)
    const bday = defaults.find((c) => c.kind === 'birthday_greeting')!
    expect(bday.isEnabled).toBe(false)
    expect(bday.marketing).toBe(true)
  })

  it('applies overrides and clamps offsets to the allowed range', () => {
    const merged = mergeAutomations([
      { kind: 'dormant_winback', is_enabled: true, offset_days: 5 },
      { kind: 'loan_final_notice', is_enabled: false, offset_days: 3 },
    ])
    const dormant = merged.find((c) => c.kind === 'dormant_winback')!
    expect(dormant.isEnabled).toBe(true)
    expect(dormant.offsetDays).toBe(30) // clamped to minOffset
    expect(dormant.customized).toBe(true)
    expect(merged.find((c) => c.kind === 'loan_final_notice')!.isEnabled).toBe(false)
  })
})

describe('isDue', () => {
  it('is due on the target day and within the catch-up window', () => {
    expect(isDue('2026-09-18', '2026-09-18')).toBe(true)
    expect(isDue('2026-09-18', '2026-09-20')).toBe(true)
    expect(isDue('2026-09-18', '2026-09-21')).toBe(false)
    expect(isDue('2026-09-18', '2026-09-17')).toBe(false)
  })
})

describe('loanStepsDueToday', () => {
  // FL loan: due 2026-10-01, forfeiture allowed from 2026-11-01.
  const base = { configs: defaults, dueDate: '2026-10-01', forfeitEligibleOn: '2026-11-01' }
  const kinds = (today: string) =>
    loanStepsDueToday({ ...base, today }).map((c) => c.kind)

  it('sends T-7 exactly 7 days before', () => {
    expect(kinds('2026-09-24')).toEqual(['loan_maturity_t7'])
  })

  it('after an outage, sends only the latest overdue step', () => {
    // 2026-09-30 is T-1; T-7 target (09-24) is outside catch-up.
    expect(kinds('2026-09-30')).toEqual(['loan_maturity_t1'])
    // due day
    expect(kinds('2026-10-01')).toEqual(['loan_due_today'])
    // T+2 is still inside T+1's catch-up window (T0 too) — latest wins
    expect(kinds('2026-10-03')).toEqual(['loan_overdue_t1'])
  })

  it('sends the final notice N days before forfeiture', () => {
    expect(kinds('2026-10-27')).toEqual(['loan_final_notice'])
  })

  it('sends nothing on quiet days', () => {
    expect(kinds('2026-10-15')).toEqual([])
  })

  it('never sends a due-anchored reminder at or after forfeiture eligibility', () => {
    const configs = mergeAutomations([
      { kind: 'loan_overdue_t7', is_enabled: true, offset_days: 31 },
    ])
    // target = 2026-11-01 = forfeitEligibleOn → suppressed
    expect(
      loanStepsDueToday({ ...base, configs, today: '2026-11-01' }).map((c) => c.kind),
    ).toEqual([])
  })
})
