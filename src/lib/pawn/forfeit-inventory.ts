/**
 * A forfeited pawn item becomes an inventory item. This is what it carries
 * over besides the description, metal, weight and cost that forfeitLoanAction
 * always copied: the brand, model and serial number (whichever category kept
 * them), the coating, and the stones.
 *
 * Why it matters: a pawned watch reached the case with no serial number, a
 * plated chain arrived as solid gold (inventory's melt value counts every
 * item whose coating is 'none'), and the stones written at the counter were
 * left behind on the ticket.
 *
 * Pure — the action does the inserts.
 */

import { COATINGS, type Coating } from '@/lib/spot-prices/purity'
import { itemIdentity } from './item-identity'
import { normalizeStones } from './stones'

export type ForfeitedCollateral = {
  coating: string | null
  jewelry_brand: string | null
  jewelry_model: string | null
  jewelry_serial: string | null
  electronic_brand: string | null
  electronic_model: string | null
  electronic_serial: string | null
  tool_brand: string | null
  tool_model: string | null
  tool_serial: string | null
  general_brand: string | null
  general_model: string | null
  general_serial: string | null
  firearm_make: string | null
  firearm_model: string | null
  firearm_serial_number: string | null
  /** loan_collateral_items.stones — the stored JSON array. */
  stones: unknown
  gemstone_notes: string | null
}

export type ForfeitedStone = {
  position: number
  count: number
  stone_type: string | null
  /** Total carats for this line (is_total_carat is always true here). */
  carat: number | null
  color: string | null
  cut: string | null
  clarity: string | null
}

export type ForfeitedInventoryDetails = {
  brand: string | null
  model: string | null
  serial_number: string | null
  coating: Coating
  stones: ForfeitedStone[]
  /** The free line about the stones; goes into the item's notes. */
  stoneNotes: string | null
}

export function inventoryDetailsFromCollateral(item: ForfeitedCollateral): ForfeitedInventoryDetails {
  const coating = (COATINGS as ReadonlyArray<string>).includes(item.coating ?? '')
    ? (item.coating as Coating)
    : 'none'
  const identity = itemIdentity(item)
  return {
    brand: identity.brand || null,
    model: identity.model || null,
    serial_number: identity.serial || null,
    coating,
    stones: normalizeStones(item.stones).map((s, i) => ({
      position: i,
      // inventory_item_stones.count is NOT NULL: an uncounted line is one.
      count: s.qty ?? 1,
      stone_type: s.type || null,
      carat: s.carat,
      color: s.color || null,
      cut: s.cut || null,
      clarity: s.clarity || null,
    })),
    stoneNotes: item.gemstone_notes?.trim() || null,
  }
}
