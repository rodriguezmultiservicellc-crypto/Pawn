/**
 * Consignment arithmetic. Pure functions — no I/O, no Supabase.
 *
 * The database is the authority on accruals: triggers in
 * patches/0054-consignment.sql write every payable row. These helpers exist
 * for the UI (previews, running balances) and are deliberately the SAME
 * formula so a clerk's preview matches what the trigger will book.
 */

export function r4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000
}

export function r2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function toMoney(v: unknown): number {
  if (v == null) return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

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

export type FloorCheck =
  | { ok: true }
  | { ok: false; effective: number; floor: number }

/**
 * Would this line break the consignor's floor price?
 *
 * Checks the EFFECTIVE unit price — after the line discount — because that
 * is what the shop actually collects and what
 * trg_sale_items_consignment_floor enforces. A UI that only checked
 * unit_price would let a clerk build a cart the database then refuses.
 */
export function checkFloorPrice(args: {
  unitPrice: number
  quantity: number
  lineDiscount?: number
  floor: number | null | undefined
}): FloorCheck {
  const floor = args.floor == null ? null : r4(toMoney(args.floor))
  if (floor == null) return { ok: true }

  const qty = toMoney(args.quantity)
  const unit = r4(toMoney(args.unitPrice))
  if (!(qty > 0)) {
    return unit < floor ? { ok: false, effective: unit, floor } : { ok: true }
  }

  const lineTotal = r4(unit * qty - toMoney(args.lineDiscount))
  const effective = r4(lineTotal / qty)
  return effective < floor ? { ok: false, effective, floor } : { ok: true }
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
