import { describe, expect, it } from 'vitest'
import {
  addDaysIso,
  bucketFor,
  daysBetweenIso,
  layawayDueDates,
  layawayStanding,
  summarize,
  type CollectionRow,
} from './aging'

describe('buckets', () => {
  it('uses the configurable edges inclusively', () => {
    const cfg = { slightDays: 7, veryDays: 30 }
    expect(bucketFor(0, cfg)).toBe('on_time')
    expect(bucketFor(-3, cfg)).toBe('on_time')
    expect(bucketFor(1, cfg)).toBe('slight')
    expect(bucketFor(7, cfg)).toBe('slight')
    expect(bucketFor(8, cfg)).toBe('very')
    expect(bucketFor(30, cfg)).toBe('very')
    expect(bucketFor(31, cfg)).toBe('urgent')
    expect(bucketFor(5, { slightDays: 3, veryDays: 10 })).toBe('very')
  })
  it('date helpers', () => {
    expect(daysBetweenIso('2026-11-01', '2026-11-04')).toBe(3)
    expect(daysBetweenIso('2026-11-04', '2026-11-01')).toBe(-3)
    expect(addDaysIso('2026-02-27', 3)).toBe('2026-03-02')
  })
})

describe('layaway schedule', () => {
  it('weekly dates between first and final', () => {
    expect(
      layawayDueDates({ scheduleKind: 'weekly', firstPaymentDue: '2026-10-01', finalDueDate: '2026-10-22' }),
    ).toEqual(['2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22'])
  })
  it('monthly dates clamp to month length', () => {
    expect(
      layawayDueDates({ scheduleKind: 'monthly', firstPaymentDue: '2026-01-31', finalDueDate: '2026-04-30' }),
    ).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
  })
  it('custom or undated schedules have no installments', () => {
    expect(layawayDueDates({ scheduleKind: 'custom', firstPaymentDue: '2026-10-01', finalDueDate: '2026-10-22' })).toEqual([])
    expect(layawayDueDates({ scheduleKind: 'weekly', firstPaymentDue: null, finalDueDate: '2026-10-22' })).toEqual([])
  })
  it('on schedule → no days late, promises kept', () => {
    const s = layawayStanding(
      { scheduleKind: 'weekly', firstPaymentDue: '2026-10-01', finalDueDate: '2026-10-22', totalDue: 500, downPayment: 100, paidTotal: 300 },
      '2026-10-09',
    )
    // 4 installments of 100; 2 due by Oct 9; paid 200 beyond down → 2 covered.
    expect(s.installmentAmount).toBe(100)
    expect(s.dueSoFar).toBe(2)
    expect(s.coveredSoFar).toBe(2)
    expect(s.shortfall).toBe(0)
    expect(s.daysLate).toBe(0)
  })
  it('one missed installment → late since that installment', () => {
    const s = layawayStanding(
      { scheduleKind: 'weekly', firstPaymentDue: '2026-10-01', finalDueDate: '2026-10-22', totalDue: 500, downPayment: 100, paidTotal: 200 },
      '2026-10-12',
    )
    expect(s.dueSoFar).toBe(2)
    expect(s.coveredSoFar).toBe(1)
    expect(s.shortfall).toBe(100)
    expect(s.daysLate).toBe(4) // Oct 8 → Oct 12
  })
  it('undated layaway is judged on the final date', () => {
    const late = layawayStanding(
      { scheduleKind: 'custom', firstPaymentDue: null, finalDueDate: '2026-10-01', totalDue: 500, downPayment: 100, paidTotal: 100 },
      '2026-10-11',
    )
    expect(late.daysLate).toBe(10)
    expect(late.dueSoFar).toBe(1)
    expect(late.coveredSoFar).toBe(0)
    const early = layawayStanding(
      { scheduleKind: 'custom', firstPaymentDue: null, finalDueDate: '2026-12-01', totalDue: 500, downPayment: 100, paidTotal: 100 },
      '2026-10-11',
    )
    expect(early.daysLate).toBe(0)
  })
})

describe('summarize', () => {
  const row = (p: Partial<CollectionRow>): CollectionRow => ({
    kind: 'loan',
    id: 'x',
    reference: 'PT-1',
    customerId: 'c1',
    customerName: 'Ana',
    phone: null,
    balance: 100,
    dueDate: null,
    daysLate: 0,
    bucket: 'on_time',
    href: '/',
    ...p,
  })
  it('totals, overdue share, buckets and top customers', () => {
    const k = summarize(
      [
        row({ balance: 100 }),
        row({ id: 'y', balance: 300, daysLate: 5, bucket: 'slight' }),
        row({ id: 'z', customerId: 'c2', customerName: 'Bo', balance: 600, daysLate: 40, bucket: 'urgent' }),
      ],
      { daysToCollectSamples: [2, 4], promisedDue: 4, promisedKept: 3 },
    )
    expect(k.totalOwed).toBe(1000)
    expect(k.overdueOwed).toBe(900)
    expect(k.overduePct).toBe(90)
    expect(k.byBucket.urgent).toEqual({ count: 1, balance: 600 })
    expect(k.topCustomers[0]).toEqual({ customerId: 'c2', customerName: 'Bo', balance: 600, rows: 1 })
    expect(k.topCustomers[1].balance).toBe(400)
    expect(k.avgDaysToCollect).toBe(3)
    expect(k.promisedKeptPct).toBe(75)
  })
  it('empty book', () => {
    const k = summarize([], { daysToCollectSamples: [], promisedDue: 0, promisedKept: 0 })
    expect(k.totalOwed).toBe(0)
    expect(k.overduePct).toBe(0)
    expect(k.avgDaysToCollect).toBeNull()
    expect(k.promisedKeptPct).toBeNull()
  })
})
