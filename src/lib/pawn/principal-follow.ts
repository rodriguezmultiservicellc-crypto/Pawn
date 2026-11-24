/**
 * New pawn ticket: the principal follows the collateral.
 *
 * Every change in what the collateral adds up to — an item added, its value
 * typed or corrected, an item removed — moves the principal by the same
 * amount. A principal the clerk typed is kept as their own difference from
 * the collateral value, so it survives the next item.
 *
 * Whole cents throughout, so adding item after item never drifts.
 */

/** Money typed in a field, as whole cents. Unreadable or empty is 0. */
export function moneyTextToCents(text: string): number {
  const n = parseFloat(text)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

/**
 * The principal after the collateral total moved by `deltaCents`.
 *
 * May come back below zero while a value is being retyped (the clerk lent
 * less than the value, then cleared the value to type a new one): keeping it
 * lets the principal land where it should once the new value is in. With no
 * items left there is nothing to be below, so it goes back to zero.
 */
export function principalAfterCollateralChange(
  principalCents: number,
  deltaCents: number,
  itemCount: number,
): number {
  const next = principalCents + deltaCents
  return itemCount === 0 && next < 0 ? 0 : next
}

/** What the principal field shows: empty rather than zero or less. */
export function principalFieldText(cents: number): string {
  return cents > 0 ? (cents / 100).toFixed(2) : ''
}
