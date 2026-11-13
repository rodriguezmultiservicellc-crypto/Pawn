/**
 * Read what a scanner typed. Pure.
 *
 * A keyboard-style barcode scanner "types" the barcode and presses Enter,
 * so every scan field funnels its text through parseScan(). It recognises
 * the payloads our tags print (lib/labels/tag-content.ts):
 *
 *   INV-000123     inventory, by SKU            ('code' payload)
 *   000123 / 123   inventory, by sku_number     ('number' payload)
 *   PT-000123-2    pawn collateral: ticket + item position (1-based)
 *   RT-000003      repair ticket
 *
 * Anything else is returned as a free 'sku' lookup, because imported
 * items keep their legacy SKU text and a tag printed for one carries it.
 */

export type ScanResult =
  | { kind: 'inventory'; sku: string; skuNumber: number | null }
  | { kind: 'collateral'; ticketNumber: string; position: number }
  | { kind: 'repair'; ticketNumber: string }
  | { kind: 'empty' }

/** sku_number padding used by the SKU trigger (patches/0003). */
export const SKU_NUMBER_DIGITS = 6

export function parseScan(raw: string): ScanResult {
  // Scanners may append CR/LF or a tab; some prefix a symbology ID.
  const text = raw.replace(/[\r\n\t]/g, '').trim()
  if (!text) return { kind: 'empty' }
  const upper = text.toUpperCase()

  const collateral = /^(PT-\d+)-(\d{1,3})$/.exec(upper)
  if (collateral) {
    return {
      kind: 'collateral',
      ticketNumber: collateral[1],
      position: Number(collateral[2]),
    }
  }

  if (/^RT-\d+$/.test(upper)) return { kind: 'repair', ticketNumber: upper }

  const invPrefixed = /^INV-(\d+)$/.exec(upper)
  if (invPrefixed) {
    return { kind: 'inventory', sku: upper, skuNumber: Number(invPrefixed[1]) }
  }

  if (/^\d{1,12}$/.test(upper)) {
    const n = Number(upper)
    return {
      kind: 'inventory',
      sku: `INV-${String(n).padStart(SKU_NUMBER_DIGITS, '0')}`,
      skuNumber: n > 0 ? n : null,
    }
  }

  // Legacy / imported SKU text — exact match, case-insensitive, at lookup.
  return { kind: 'inventory', sku: text, skuNumber: null }
}

/** The barcode text for a pawn collateral item (position is 0-based in the DB). */
export function collateralCode(ticketNumber: string, dbPosition: number): string {
  return `${ticketNumber}-${dbPosition + 1}`
}
