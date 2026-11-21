/** Receipt print formats — shared by the print route and the POS dialog. */
export const RECEIPT_FORMATS = ['letter', 'thermal'] as const
export type ReceiptFormat = (typeof RECEIPT_FORMATS)[number]

export function isReceiptFormat(v: unknown): v is ReceiptFormat {
  return typeof v === 'string' && (RECEIPT_FORMATS as readonly string[]).includes(v)
}
