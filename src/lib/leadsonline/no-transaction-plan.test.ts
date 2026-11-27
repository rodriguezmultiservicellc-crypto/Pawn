import { describe, expect, it } from 'vitest'
import { planNoTransactionDays } from './no-transaction-plan'
import { setNoTransactionDayEnvelope, usDateOf } from './soap'

describe('planNoTransactionDays', () => {
  const base = { today: '2026-11-28', ticketDays: new Set<string>(), doneDays: new Set<string>() }

  it('sends nothing before Sol Pawn has reported a ticket', () => {
    expect(planNoTransactionDays({ ...base, startDay: null })).toEqual([])
  })

  it('sends finished days from the start day, never today', () => {
    expect(planNoTransactionDays({ ...base, startDay: '2026-11-25' })).toEqual(['2026-11-25', '2026-11-26', '2026-11-27'])
  })

  it('skips days with tickets and days already accepted', () => {
    expect(
      planNoTransactionDays({
        ...base,
        startDay: '2026-11-25',
        ticketDays: new Set(['2026-11-25']),
        doneDays: new Set(['2026-11-26']),
      }),
    ).toEqual(['2026-11-27'])
  })

  it('catches up at most the lookback window', () => {
    expect(planNoTransactionDays({ ...base, startDay: '2026-01-01', lookbackDays: 3 })).toEqual([
      '2026-11-25',
      '2026-11-26',
      '2026-11-27',
    ])
  })

  it('crosses a month end', () => {
    expect(planNoTransactionDays({ ...base, today: '2026-12-02', startDay: '2026-11-30' })).toEqual([
      '2026-11-30',
      '2026-12-01',
    ])
  })
})

describe('SetNoTransactionDayForStore', () => {
  it('writes the date as MM/DD/YYYY before the login', () => {
    expect(usDateOf('2026-11-26')).toBe('11/26/2026')
    const x = setNoTransactionDayEnvelope({ storeId: 57434, userName: 'u', password: 'p' }, '2026-11-26')
    expect(x).toContain(
      '<SetNoTransactionDayForStore xmlns="http://www.leadsonline.com/"><ApiVersion xsi:nil="true"/><TransactionDate>11/26/2026</TransactionDate><login>',
    )
  })
})
