import type { CollateralItemInput } from '@/lib/validations/loan'

/**
 * One item of compliance_log.items_snapshot, as the New pawn ticket screen
 * describes it — the same fields for a pawn and for a purchase written on
 * the transaction form (patches/0115), so the police file (it reads them
 * through itemIdentity) and the printed form see the same piece. The caller
 * adds what only it knows: photos, position, and for a purchase the
 * inventory item and the price paid.
 */
export function collateralSnapshot(it: CollateralItemInput) {
  return {
    description: it.description,
    category: it.category,
    metal_type: it.metal_type ?? null,
    karat: it.karat,
    weight_grams: it.weight_grams,
    coating: it.coating,
    jewelry_size: it.jewelry_size,
    color: it.color,
    gemstone_description: it.gemstone_description,
    stones: it.stones,
    gemstone_notes: it.gemstone_notes,
    jewelry_gender: it.jewelry_gender,
    jewelry_style: it.jewelry_style,
    jewelry_brand: it.jewelry_brand,
    jewelry_model: it.jewelry_model,
    jewelry_serial: it.jewelry_serial,
    unique_marks: it.unique_marks,
    est_value: it.est_value,
    pawn_category_slug: it.pawn_category_slug,
    pawn_subcategory_slug: it.pawn_subcategory_slug,
    // FL Ch. 539 reporting reads firearm fields out of this snapshot.
    firearm_make: it.firearm_make,
    firearm_model: it.firearm_model,
    firearm_caliber: it.firearm_caliber,
    firearm_serial_number: it.firearm_serial_number,
    firearm_type: it.firearm_type,
    firearm_barrel_length_inches: it.firearm_barrel_length_inches,
    firearm_action_type: it.firearm_action_type,
    firearm_capacity: it.firearm_capacity,
    firearm_finish: it.firearm_finish,
    firearm_number_of_barrels: it.firearm_number_of_barrels,
    electronic_brand: it.electronic_brand,
    electronic_model: it.electronic_model,
    electronic_serial: it.electronic_serial,
    tool_brand: it.tool_brand,
    tool_model: it.tool_model,
    tool_serial: it.tool_serial,
    general_brand: it.general_brand,
    general_model: it.general_model,
    general_serial: it.general_serial,
    item_size: it.item_size,
  }
}
