/**
 * Translated labels for inventory enums. Pure; usable from client and
 * server components (pass the active dictionary).
 */

import type { Dictionary } from '@/lib/i18n/en'
import type { Database } from '@/types/database'

type Category = Database['public']['Enums']['inventory_category']
type Location = Database['public']['Enums']['inventory_location']

export function categoryLabel(c: Category, t: Dictionary): string {
  switch (c) {
    case 'ring': return t.inventory.catRing
    case 'necklace': return t.inventory.catNecklace
    case 'bracelet': return t.inventory.catBracelet
    case 'earrings': return t.inventory.catEarrings
    case 'pendant': return t.inventory.catPendant
    case 'chain': return t.inventory.catChain
    case 'watch': return t.inventory.catWatch
    case 'coin': return t.inventory.catCoin
    case 'bullion': return t.inventory.catBullion
    case 'loose_stone': return t.inventory.catLooseStone
    case 'electronics': return t.inventory.catElectronics
    case 'tool': return t.inventory.catTool
    case 'instrument': return t.inventory.catInstrument
    case 'other': return t.inventory.catOther
  }
}

export function locationLabel(l: Location, t: Dictionary): string {
  switch (l) {
    case 'case': return t.inventory.locCase
    case 'safe': return t.inventory.locSafe
    case 'vault': return t.inventory.locVault
    case 'display': return t.inventory.locDisplay
    case 'workshop': return t.inventory.locWorkshop
    case 'offsite': return t.inventory.locOffsite
    case 'transfer': return t.inventory.locTransfer
  }
}
