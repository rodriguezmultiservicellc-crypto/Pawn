/**
 * A pawned item's brand, model and serial number, whichever category's
 * columns hold them.
 *
 * loan_collateral_items keeps these per category — firearm_make /
 * firearm_model / firearm_serial_number, electronic_*, tool_*, jewelry_*
 * (patches/0106), general_* (patches/0107). Fla. Stat. § 539.001(8)(b)2.a-c
 * asks for one brand, one model and one serial number per item, so every
 * reader — the printed ticket, the police export, the audit report, the
 * forfeit copy, "Pawned before" — reads them through here. A new category
 * prefix is added in this one place.
 *
 * Takes a row or a compliance_log snapshot (untyped JSON): anything that is
 * not a non-empty string counts as absent. Returns '' for what is missing.
 */

const BRAND = ['firearm_make', 'electronic_brand', 'tool_brand', 'jewelry_brand', 'general_brand'] as const
const MODEL = ['firearm_model', 'electronic_model', 'tool_model', 'jewelry_model', 'general_model'] as const
const SERIAL = [
  'firearm_serial_number',
  'electronic_serial',
  'tool_serial',
  'jewelry_serial',
  'general_serial',
] as const

function first(item: Readonly<Record<string, unknown>>, keys: ReadonlyArray<string>): string {
  for (const k of keys) {
    const v = item[k]
    if (typeof v === 'string' && v.trim() !== '') return v.trim()
  }
  return ''
}

export type ItemIdentity = { brand: string; model: string; serial: string }

export function itemIdentity(item: Readonly<Record<string, unknown>>): ItemIdentity {
  return {
    brand: first(item, BRAND),
    model: first(item, MODEL),
    serial: first(item, SERIAL),
  }
}
