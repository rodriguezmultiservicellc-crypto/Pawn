/**
 * Collections math (brief Phase 4.3). Pure.
 *
 * Buckets are configurable per tenant (settings.collections_slight_days /
 * collections_very_days, patches/0068):
 *   on_time      daysLate <= 0
 *   slight       1 .. slightDays
 *   very         slightDays+1 .. veryDays
 *   urgent       > veryDays
 */

import { r4 } from '@/lib/pos/cart'

export type AgingBucket = 'on_time' | 'slight' | 'very' | 'urgent'
export const AGING_BUCKETS: ReadonlyArray<AgingBucket> = ['on_time', 'slight', 'very', 'urgent']

export type AgingConfig = { slightDays: number; veryDays: number }
export const DEFAULT_AGING: AgingConfig = { slightDays: 7, veryDays: 30 }

export function bucketFor(daysLate: number, cfg: AgingConfig = DEFAULT_AGING): AgingBucket {
  if (!(daysLate > 0)) return 'on_time'
  if (daysLate <= cfg.slightDays) return 'slight'
  if (daysLate <= cfg.veryDays) return 'very'
  return 'urgent'
}

/** Whole days from `from` to `to` (YYYY-MM-DD each), negative when `to` is earlier. */
export function daysBetweenIso(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10))
  return Math.round((b - a) / 86_400_000)
}

export function addDaysIso(date: string, days: number): string {
  const d = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)))
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function addMonthsIso(date: string, months: number): string {
  const y = +date.slice(0, 4)
  const m = +date.slice(5, 7) - 1
  const day = +date.slice(8, 10)
  const d = new Date(Date.UTC(y, m + months, 1))
  // Clamp to the target month's length (Jan 31 + 1 month = Feb 28/29).
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, last))
  return d.toISOString().slice(0, 10)
}

// ── Layaway schedule ───────────────────────────────────────────────────────

export type LayawaySchedule = {
  scheduleKind: 'weekly' | 'biweekly' | 'monthly' | 'custom' | string
  firstPaymentDue: string | null
  finalDueDate: string | null
  totalDue: number
  downPayment: number
  paidTotal: number
}

export type LayawayStanding = {
  /** Installment due dates derived from the schedule (empty for custom / undated). */
  dueDates: string[]
  installmentAmount: number
  /** Installments whose due date is on or before today. */
  dueSoFar: number
  /** Installments fully covered by what has been paid (down payment excluded). */
  coveredSoFar: number
  /** What should have been paid by today, down payment included. */
  expectedPaid: number
  shortfall: number
  /** Days since the first uncovered installment's due date; 0 when on schedule. */
  daysLate: number
}

/**
 * Installment dates between first_payment_due and final_due_date for a
 * weekly / biweekly / monthly schedule. 'custom' (or missing dates) yields
 * none — the layaway is then judged on its final due date alone.
 */
export function layawayDueDates(s: Pick<LayawaySchedule, 'scheduleKind' | 'firstPaymentDue' | 'finalDueDate'>): string[] {
  if (!s.firstPaymentDue || !s.finalDueDate) return []
  if (s.finalDueDate < s.firstPaymentDue) return []
  const out: string[] = []
  let cursor = s.firstPaymentDue
  for (let i = 0; i < 400 && cursor <= s.finalDueDate; i++) {
    out.push(cursor)
    if (s.scheduleKind === 'weekly') cursor = addDaysIso(cursor, 7)
    else if (s.scheduleKind === 'biweekly') cursor = addDaysIso(cursor, 14)
    else if (s.scheduleKind === 'monthly') cursor = addMonthsIso(s.firstPaymentDue, i + 1)
    else return []
  }
  return out
}

/**
 * Where a layaway stands against its promise today. "Promised payments
 * kept" (the brief's KPI) is coveredSoFar / dueSoFar across layaways.
 */
export function layawayStanding(s: LayawaySchedule, today: string): LayawayStanding {
  const dueDates = layawayDueDates(s)
  const owed = r4(Math.max(0, s.totalDue - s.downPayment))
  const paidBeyondDown = r4(Math.max(0, s.paidTotal - s.downPayment))

  if (dueDates.length === 0) {
    // Undated / custom: the only promise is the final date.
    const late = s.finalDueDate && s.totalDue - s.paidTotal > 0.005 ? daysBetweenIso(s.finalDueDate, today) : 0
    return {
      dueDates,
      installmentAmount: owed,
      dueSoFar: s.finalDueDate && s.finalDueDate <= today ? 1 : 0,
      coveredSoFar: s.totalDue - s.paidTotal <= 0.005 ? 1 : 0,
      expectedPaid: s.finalDueDate && s.finalDueDate <= today ? s.totalDue : s.downPayment,
      shortfall: r4(Math.max(0, (s.finalDueDate && s.finalDueDate <= today ? s.totalDue : s.downPayment) - s.paidTotal)),
      daysLate: Math.max(0, late),
    }
  }

  const installmentAmount = r4(owed / dueDates.length)
  const dueSoFar = dueDates.filter((d) => d <= today).length
  const coveredSoFar =
    installmentAmount > 0
      ? Math.min(dueDates.length, Math.floor((paidBeyondDown + 0.005) / installmentAmount))
      : dueDates.length
  const expectedPaid = r4(s.downPayment + installmentAmount * dueSoFar)
  const shortfall = r4(Math.max(0, expectedPaid - s.paidTotal))
  let daysLate = 0
  if (shortfall > 0.005 && coveredSoFar < dueSoFar) {
    daysLate = Math.max(0, daysBetweenIso(dueDates[coveredSoFar], today))
  }
  return { dueDates, installmentAmount, dueSoFar, coveredSoFar, expectedPaid, shortfall, daysLate }
}

// ── Rows + KPIs ────────────────────────────────────────────────────────────

export type CollectionKind = 'loan' | 'layaway' | 'repair'

export type CollectionRow = {
  kind: CollectionKind
  id: string
  /** PT-000123 / L-000045 / RT-000678 */
  reference: string
  customerId: string | null
  customerName: string
  phone: string | null
  balance: number
  dueDate: string | null
  daysLate: number
  bucket: AgingBucket
  href: string
}

export type CollectionKpis = {
  totalOwed: number
  overdueOwed: number
  overduePct: number
  rowCount: number
  overdueCount: number
  /** Mean days late at the moment of payment, recent window; null when nothing was collected. */
  avgDaysToCollect: number | null
  promisedDue: number
  promisedKept: number
  promisedKeptPct: number | null
  byBucket: Record<AgingBucket, { count: number; balance: number }>
  topCustomers: Array<{ customerId: string | null; customerName: string; balance: number; rows: number }>
}

export function summarize(
  rows: ReadonlyArray<CollectionRow>,
  extra: { daysToCollectSamples: number[]; promisedDue: number; promisedKept: number },
): CollectionKpis {
  const byBucket: CollectionKpis['byBucket'] = {
    on_time: { count: 0, balance: 0 },
    slight: { count: 0, balance: 0 },
    very: { count: 0, balance: 0 },
    urgent: { count: 0, balance: 0 },
  }
  let totalOwed = 0
  let overdueOwed = 0
  let overdueCount = 0
  const byCustomer = new Map<string, { customerId: string | null; customerName: string; balance: number; rows: number }>()
  for (const r of rows) {
    totalOwed = r4(totalOwed + r.balance)
    byBucket[r.bucket].count += 1
    byBucket[r.bucket].balance = r4(byBucket[r.bucket].balance + r.balance)
    if (r.bucket !== 'on_time') {
      overdueOwed = r4(overdueOwed + r.balance)
      overdueCount += 1
    }
    const key = r.customerId ?? `anon:${r.customerName}`
    const c = byCustomer.get(key) ?? { customerId: r.customerId, customerName: r.customerName, balance: 0, rows: 0 }
    c.balance = r4(c.balance + r.balance)
    c.rows += 1
    byCustomer.set(key, c)
  }
  const samples = extra.daysToCollectSamples
  const avg = samples.length > 0 ? Math.round((samples.reduce((s, n) => s + n, 0) / samples.length) * 10) / 10 : null
  return {
    totalOwed,
    overdueOwed,
    overduePct: totalOwed > 0 ? Math.round((overdueOwed / totalOwed) * 1000) / 10 : 0,
    rowCount: rows.length,
    overdueCount,
    avgDaysToCollect: avg,
    promisedDue: extra.promisedDue,
    promisedKept: extra.promisedKept,
    promisedKeptPct:
      extra.promisedDue > 0 ? Math.round((extra.promisedKept / extra.promisedDue) * 1000) / 10 : null,
    byBucket,
    topCustomers: Array.from(byCustomer.values())
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 5),
  }
}
