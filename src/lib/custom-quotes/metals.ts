import type { MetalType } from '@/types/database-aliases'

/** Metals the quoter offers, with the karats that make sense for each. Pure — shared by the form and the spot preload. */
export const QUOTE_METALS: ReadonlyArray<{ metal: MetalType; karats: ReadonlyArray<string> }> = [
  { metal: 'gold', karats: ['24', '22', '18', '14', '10'] },
  { metal: 'white_gold', karats: ['18', '14', '10'] },
  { metal: 'rose_gold', karats: ['18', '14', '10'] },
  { metal: 'silver', karats: [] },
  { metal: 'platinum', karats: [] },
  { metal: 'palladium', karats: [] },
]

/** Key into the preloaded spot map: `${metal}:${karat}` ('' karat for non-gold). */
export function spotKey(metal: string, karat: string | null | undefined): string {
  return `${metal}:${karat ?? ''}`
}
