import type { PawnTicketCollateral } from './PawnTicketPDF'
import type { InventoryCategory, MetalType } from '@/types/database-aliases'

type Obj = Record<string, unknown>

/** A snapshot value as text / a number; null when empty. */
export const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v : null
export const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

/** One piece of the snapshot as the form prints it. A purchase written on
 *  the form carries every field; an older Buy outright row has fewer (its
 *  serial number becomes the general serial). */
export function purchaseItemFromSnapshot(it: Obj): PawnTicketCollateral {
  const hasIdentity = [
    'jewelry_serial',
    'firearm_serial_number',
    'electronic_serial',
    'tool_serial',
    'general_serial',
  ].some((k) => str(it[k]))
  return {
    description: str(it.description) ?? '',
    category: (str(it.category) ?? 'other') as InventoryCategory,
    metal_type: (str(it.metal_type) as MetalType | null) ?? null,
    karat: num(it.karat),
    weight_grams: num(it.weight_grams),
    // The price paid for the piece is its Amount on the form.
    est_value: num(it.payout) ?? num(it.est_value) ?? 0,
    jewelry_size: str(it.jewelry_size),
    color: str(it.color),
    gemstone_description: str(it.gemstone_description),
    jewelry_gender: str(it.jewelry_gender),
    jewelry_style: str(it.jewelry_style),
    jewelry_brand: str(it.jewelry_brand),
    jewelry_model: str(it.jewelry_model),
    jewelry_serial: str(it.jewelry_serial),
    unique_marks: str(it.unique_marks),
    firearm_make: str(it.firearm_make),
    firearm_model: str(it.firearm_model),
    firearm_caliber: str(it.firearm_caliber),
    firearm_serial_number: str(it.firearm_serial_number),
    firearm_type: str(it.firearm_type),
    firearm_barrel_length_inches: num(it.firearm_barrel_length_inches),
    firearm_action_type: str(it.firearm_action_type),
    firearm_capacity: num(it.firearm_capacity),
    firearm_finish: str(it.firearm_finish),
    firearm_number_of_barrels: num(it.firearm_number_of_barrels),
    electronic_brand: str(it.electronic_brand),
    electronic_model: str(it.electronic_model),
    electronic_serial: str(it.electronic_serial),
    tool_brand: str(it.tool_brand),
    tool_model: str(it.tool_model),
    tool_serial: str(it.tool_serial),
    general_brand: str(it.general_brand),
    general_model: str(it.general_model),
    general_serial: str(it.general_serial) ?? (hasIdentity ? null : str(it.serial_number)),
    item_size: str(it.item_size),
  }
}
