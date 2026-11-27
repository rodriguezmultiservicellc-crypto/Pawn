/**
 * Pure repair-ticket billing helpers. Decimal-safe within JS Number
 * precision: every result is rounded to 4 decimal places before further
 * use, matching the `numeric(18,4)` storage shape we use for money columns.
 *
 * Mirrors lib/pawn/math's r4 / toMoney conventions.
 *
 * Time-billed estimates intentionally STUBBED for v1 — technician hourly
 * rate config lands in Phase 7+ (per-tenant settings). The time_logs table
 * captures the data; this helper only sums elapsed hours.
 */

import type { RepairTicketItemRow } from '@/types/database-aliases'

const SCALE = 10000

/** Round to 4 decimal places. */
export function r4(n: number): number {
  if (!isFinite(n)) return 0
  return Math.round(n * SCALE) / SCALE
}

/** Coerce a string|number|null|undefined money value to a Number rounded to 4dp. */
export function toMoney(v: string | number | null | undefined): number {
  if (v == null) return 0
  const n = typeof v === 'string' ? parseFloat(v) : v
  return r4(n)
}

// ── Balance due ────────────────────────────────────────────────────────────

export type BalanceDueArgs = {
  /** Quoted amount (NULL when not quoted yet). */
  quote: number | string | null | undefined
  /** Deposit collected (0 when not collected yet). */
  deposit: number | string | null | undefined
  /** Any additional payments applied (e.g. partial payments mid-job). */
  paymentsApplied?: number | string | null | undefined
}

/**
 * Compute outstanding balance due. Returns null when no quote has been set
 * (mirrors the `repair_tickets.balance_due` column semantics — NULL until
 * quote_amount is non-null). Floors at 0.
 */
export function computeBalanceDue(args: BalanceDueArgs): number | null {
  if (args.quote == null) return null
  const q = toMoney(args.quote)
  const d = toMoney(args.deposit)
  const p = toMoney(args.paymentsApplied)
  return r4(Math.max(0, q - d - p))
}

// ── Parts COGS ─────────────────────────────────────────────────────────────

/**
 * Sum total_cost across an array of repair_ticket_items rows. Soft-deleted
 * rows are NOT filtered here — caller should pass already-filtered rows.
 */
export function partsCogs(
  items: ReadonlyArray<Pick<RepairTicketItemRow, 'total_cost'>>,
): number {
  let total = 0
  for (const it of items) {
    total += toMoney(it.total_cost)
  }
  return r4(total)
}

// ── Profit / loss of one ticket ────────────────────────────────────────────

export type RepairProfit = {
  /** True once the ticket is closed: the figures are what really came in. */
  final: boolean
  /** Closed: deposit + paid. Open: the quote (what the job should bring). */
  revenue: number
  partsCost: number
  /** Timer hours x the shop's labor rate; null when no rate is set. */
  laborCost: number | null
  profit: number
  /** profit / revenue; null when there is no revenue to divide by. */
  margin: number | null
}

/**
 * What one repair made or lost. A closed ticket counts the money that came
 * in (deposit + payments); an open one is figured on its quote, falling
 * back to what has come in when it is not quoted yet. Costs are the parts
 * plus labor (timer hours x `settings.repair_labor_rate`); with no rate set
 * labor is left out and `laborCost` is null.
 */
export function repairProfit(args: {
  quote: number | string | null | undefined
  deposit: number | string | null | undefined
  paid: number | string | null | undefined
  partsCost: number | string | null | undefined
  laborHours: number
  laborRate: number | string | null | undefined
  closed: boolean
}): RepairProfit {
  const collected = r4(toMoney(args.deposit) + toMoney(args.paid))
  const revenue = args.closed || args.quote == null ? collected : toMoney(args.quote)
  const partsCost = toMoney(args.partsCost)
  const laborCost = args.laborRate == null ? null : r4(args.laborHours * toMoney(args.laborRate))
  const profit = r4(revenue - partsCost - (laborCost ?? 0))
  return {
    final: args.closed,
    revenue,
    partsCost,
    laborCost,
    profit,
    margin: revenue > 0 ? profit / revenue : null,
  }
}

/** Compute total_cost = quantity * unit_cost, rounded to 4dp. */
export function lineTotalCost(args: {
  quantity: number | string | null | undefined
  unit_cost: number | string | null | undefined
}): number {
  const q = toMoney(args.quantity)
  const u = toMoney(args.unit_cost)
  return r4(q * u)
}

// ── Time-billed estimate (STUB) ────────────────────────────────────────────

export type TimeLogRow = {
  started_at: string
  stopped_at: string | null
}

/**
 * Sum elapsed milliseconds across a set of time_logs. Open-ended sessions
 * (stopped_at IS NULL) are summed against `now`. Returns total milliseconds.
 *
 * NOTE: Phase 7+ will multiply this by a per-tenant technician hourly rate
 * to surface a billable-time estimate. v1 just exposes the elapsed total.
 */
export function elapsedTimeMs(
  logs: ReadonlyArray<TimeLogRow>,
  now: number = Date.now(),
): number {
  let total = 0
  for (const l of logs) {
    const start = Date.parse(l.started_at)
    if (!isFinite(start)) continue
    const stop = l.stopped_at ? Date.parse(l.stopped_at) : now
    if (!isFinite(stop)) continue
    total += Math.max(0, stop - start)
  }
  return total
}

export type TechnicianTime = {
  technician_id: string
  /** Every session of this technician on the ticket, a running one to `now`. */
  ms: number
  /** A timer of theirs is running right now. */
  running: boolean
}

/** Time on one ticket per technician, most time first. */
export function timeByTechnician(
  logs: ReadonlyArray<TimeLogRow & { technician_id: string }>,
  now: number = Date.now(),
): TechnicianTime[] {
  const by = new Map<string, TechnicianTime>()
  for (const l of logs) {
    const row = by.get(l.technician_id) ?? { technician_id: l.technician_id, ms: 0, running: false }
    row.ms += elapsedTimeMs([l], now)
    if (l.stopped_at == null) row.running = true
    by.set(l.technician_id, row)
  }
  return [...by.values()].sort((a, b) => b.ms - a.ms)
}

/** Convenience: elapsed time as fractional hours (4dp). */
export function elapsedHours(
  logs: ReadonlyArray<TimeLogRow>,
  now: number = Date.now(),
): number {
  return r4(elapsedTimeMs(logs, now) / 3_600_000)
}

/**
 * STUB for time-billed estimate. Phase 7+ will pull `hourly_rate_cents` from
 * tenant settings; for v1 we accept the rate as a parameter so the call site
 * can leave it null. Returns null when no rate is provided.
 */
export function timeBilledEstimate(args: {
  logs: ReadonlyArray<TimeLogRow>
  hourlyRate?: number | null
  now?: number
}): number | null {
  if (args.hourlyRate == null) return null
  const hours = elapsedHours(args.logs, args.now ?? Date.now())
  return r4(hours * args.hourlyRate)
}
