import type { z } from 'zod'
import { isPurityInput, purityForInventory } from '@/lib/spot-prices/purity'

/**
 * The server half of the Karat / Purity field for a row that becomes an
 * inventory item (Buy outright, the inventory form): a purity the metal
 * cannot have is refused, and an accepted one is kept as inventory keeps it
 * ("14K", "925"; lib/spot-prices/purity purityForInventory).
 */
type WithPurity = { metal?: string | null; karat?: string | null }

export function checkInventoryPurity(val: WithPurity, ctx: z.RefinementCtx): void {
  if (!isPurityInput(val.metal ?? null, val.karat ?? null)) {
    ctx.addIssue({ code: 'custom', path: ['karat'], message: 'karat_for_metal' })
  }
}

export function keepInventoryPurity<T extends WithPurity>(val: T): T {
  return { ...val, karat: purityForInventory(val.metal ?? null, val.karat ?? null) }
}
