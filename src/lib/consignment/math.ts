/**
 * Consignment arithmetic. Pure functions — no I/O, no Supabase.
 *
 * The database is the authority on accruals: triggers in
 * patches/0054-consignment.sql write every payable row. These helpers exist
 * for the UI (previews, running balances) and are deliberately the SAME
 * formula so a clerk's preview matches what the trigger will book.
 */

import { r2, r4, toMoney } from '@/lib/money'

// Re-exported so callers of this module keep one import for consignment
// arithmetic. The implementations live in lib/money.ts.
export { r2, r4, toMoney }

export type ConsignmentSplit = {
  /** What the line realized. */
  gross: number
  /** The shop's cut. */
  commission: number
  /** What the consignor is owed. */
  payable: number
}

/**
 * Split a realized sale amount between the shop and the consignor.
 *
 * `commissionPct` is a fraction of the gross, not a percentage: 0.2 means
 * the shop keeps 20% and the consignor gets 80%. Mirrors
 * consignment_accrue_on_sale() exactly, including the rounding order —
 * commission is rounded first, and the payable is the remainder, so the two
 * always add back up to the gross with no lost cent.
 */
export function splitConsignment(args: {
  gross: number
  commissionPct: number
}): ConsignmentSplit {
  const gross = r4(toMoney(args.gross))
  const pct = Math.min(Math.max(toMoney(args.commissionPct), 0), 1)
  const commission = r4(gross * pct)
  return { gross, commission, payable: r4(gross - commission) }
}

/**
 * A consignor's open balance: the signed sum of every unpaid ledger row.
 *
 * Negative is a real state, not an error — it means a return or void landed
 * after the consignor had already been paid, so they owe the shop. The next
 * payout nets it off.
 */
export function openBalance(
  rows: ReadonlyArray<{ payable_amount: number | string; status: string }>,
): number {
  return r4(
    rows
      .filter((r) => r.status === 'open')
      .reduce((acc, r) => acc + toMoney(r.payable_amount), 0),
  )
}

/** Lifetime gross sold for a consignor, reversals included. */
export function lifetimeGross(
  rows: ReadonlyArray<{ gross_amount: number | string }>,
): number {
  return r4(rows.reduce((acc, r) => acc + toMoney(r.gross_amount), 0))
}

/** Lifetime commission the shop earned, reversals included. */
export function lifetimeCommission(
  rows: ReadonlyArray<{ commission_amount: number | string }>,
): number {
  return r4(rows.reduce((acc, r) => acc + toMoney(r.commission_amount), 0))
}

/**
 * Days until a consignment agreement ends. Negative once it has lapsed,
 * null when no end date was agreed. Both dates are plain YYYY-MM-DD in the
 * shop's calendar — never UTC timestamps (CLAUDE.md Rule 18).
 */
export function daysUntilExpiry(
  expiresOn: string | null | undefined,
  todayIso: string,
): number | null {
  if (!expiresOn) return null
  const end = Date.parse(`${expiresOn}T00:00:00Z`)
  const today = Date.parse(`${todayIso}T00:00:00Z`)
  if (!Number.isFinite(end) || !Number.isFinite(today)) return null
  return Math.round((end - today) / 86_400_000)
}
