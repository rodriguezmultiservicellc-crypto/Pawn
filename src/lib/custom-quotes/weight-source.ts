/**
 * Weight sources for the custom-piece quoter (brief Phase 2, "hook for
 * later").
 *
 * The metal line of a quote needs a weight in grams. Today staff type it.
 * Later the fiber-laser NAMEPLATE app will compute the weight of a design
 * (from the vector outline × thickness × alloy density) and hand it over,
 * so the quote never depends on a guessed weight. This module is the seam
 * for that: the form asks `WEIGHT_SOURCES` what is available and renders a
 * "Weight from…" selector; a source either returns grams or null.
 *
 * TODO(laser-nameplate): implement `laserNameplateWeightSource`:
 *   - transport: the nameplate app exposes a design's computed weight by
 *     design id (REST; URL + token to live in settings / the tenant vault,
 *     NEVER in a NEXT_PUBLIC_* var);
 *   - inputs: a design id pasted/scanned on the quote, plus the alloy
 *     (metal + karat) already chosen on the metal line so density matches;
 *   - output: grams, rounded to 4 dp; null when the design is unknown;
 *   - mark `available: true` only when the tenant has the integration
 *     configured, so the selector keeps showing "Manual" alone until then.
 * Nothing else in the quoter should need to change: the metal line just
 * receives `weight_grams` from whichever source the staff member picked.
 */

import type { Language } from '@/lib/i18n/config'
import type { CustomPieceCategory } from '@/types/database-aliases'

export type WeightSourceId = 'manual' | 'laser_nameplate'

export type WeightSourceRequest = {
  category: CustomPieceCategory
  /** Free-text description of the piece — a nameplate design may be referenced here. */
  description: string
  /** Metal + karat chosen on the metal line (alloy density differs per karat). */
  metal: string | null
  karat: string | null
  /** External design reference (laser app), when the staff member entered one. */
  designRef?: string | null
}

export type WeightSource = {
  id: WeightSourceId
  label: Record<Language, string>
  /** False hides the option; true shows it in the "Weight from…" selector. */
  available: boolean
  /** Grams for the request, or null when the source cannot answer. Never throws. */
  fetchWeightGrams(req: WeightSourceRequest): Promise<number | null>
}

export const manualWeightSource: WeightSource = {
  id: 'manual',
  label: { en: 'Typed by staff', es: 'Escrito por el personal' },
  available: true,
  // Manual means "the input field is the source" — nothing to fetch.
  fetchWeightGrams: async () => null,
}

/**
 * Placeholder so the selector, the saved `details.weight_source` value and
 * the audit trail already know the id. Stays unavailable until the
 * integration above exists.
 */
export const laserNameplateWeightSource: WeightSource = {
  id: 'laser_nameplate',
  label: { en: 'Laser nameplate app', es: 'App de placas láser' },
  available: false,
  fetchWeightGrams: async () => null,
}

export const WEIGHT_SOURCES: ReadonlyArray<WeightSource> = [
  manualWeightSource,
  laserNameplateWeightSource,
]
