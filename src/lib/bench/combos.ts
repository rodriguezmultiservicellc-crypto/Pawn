import type { MetalPurity, MetalType } from '@/types/database-aliases'

/**
 * Every (metal, purity) the counter prices — the client-safe twin of
 * lib/metal-counter/rates COUNTER_COMBOS (that module is server-only
 * because it loads the feed). Keep the two lists identical.
 */
export const COUNTER_COMBOS_CLIENT: ReadonlyArray<{ metalType: MetalType; purity: MetalPurity }> = [
  { metalType: 'gold', purity: 'pure_24k' },
  { metalType: 'gold', purity: 'fine' },
  { metalType: 'gold', purity: '22k' },
  { metalType: 'gold', purity: '18k' },
  { metalType: 'gold', purity: '14k' },
  { metalType: 'gold', purity: '10k' },
  { metalType: 'silver', purity: 'fine' },
  { metalType: 'silver', purity: 'sterling_925' },
  { metalType: 'platinum', purity: 'platinum_950' },
  { metalType: 'palladium', purity: 'palladium_950' },
]
