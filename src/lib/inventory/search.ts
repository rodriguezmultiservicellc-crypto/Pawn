/**
 * The inventory list search. Pure: builds PostgREST `or` filters, one per
 * word typed, and the list ANDs them — "14k 2.4g ring" finds the 14K rings
 * that weigh 2.4 grams.
 *
 * Each word matches any of:
 *   - the text fields (SKU, description, brand, model, serial, legacy code,
 *     karat, shelf, size, finish), as a substring;
 *   - the metal and the category, by the start of a word of their English or
 *     Spanish label ("gold" → gold, rose gold, white gold; "anillo" → ring);
 *   - the weight, when the word is a number: "2.4" = 2.4 g or 2.4 dwt,
 *     "2.4g" = grams only, "1.5dwt" = dwt only.
 */

import { en } from '@/lib/i18n/en'
import { es } from '@/lib/i18n/es'
import { Constants } from '@/types/database'
import { categoryLabel, metalLabel } from './labels'

const TEXT_FIELDS = [
  'sku',
  'description',
  'brand',
  'model',
  'serial_number',
  'legacy_code',
  'karat',
  'shelf_location',
  'jewelry_size',
  'finish',
] as const

/** Rows per page of the inventory list. */
export const INVENTORY_PAGE_SIZE = 50

/** Words past this many are ignored: each one is another filter. */
const MAX_WORDS = 6
const MAX_WORD_LENGTH = 40

const WEIGHT = /^(\d+(?:\.\d+)?)(g|gr|grams?|gramos?|dwt)?$/i

function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/** True when a word of the label starts with the typed word. */
function labelHit(label: string, word: string): boolean {
  return fold(label).split(/[\s/-]+/).some((w) => w.startsWith(word))
}

/** The words of a search, cleaned of the characters PostgREST reserves in
 *  an `or` filter (`,` `(` `)` `"` and the backslash). */
export function searchWords(q: string): string[] {
  return q
    .split(/\s+/)
    .map((w) => w.replace(/[,()"\\]/g, '').slice(0, MAX_WORD_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_WORDS)
}

/** One `or` filter for one word. */
export function wordFilter(word: string): string {
  const like = word.replace(/[%_]/g, (m) => '\\' + m)
  const parts: string[] = TEXT_FIELDS.map((f) => `${f}.ilike.%${like}%`)

  const folded = fold(word)
  if (folded.length >= 3) {
    const metals = Constants.public.Enums.metal_type.filter(
      (m) => labelHit(metalLabel(m, en), folded) || labelHit(metalLabel(m, es), folded),
    )
    if (metals.length) parts.push(`metal.in.(${metals.join(',')})`)
    const categories = Constants.public.Enums.inventory_category.filter(
      (c) => labelHit(categoryLabel(c, en), folded) || labelHit(categoryLabel(c, es), folded),
    )
    if (categories.length) parts.push(`category.in.(${categories.join(',')})`)
  }

  const weight = WEIGHT.exec(word)
  if (weight) {
    const n = weight[1]
    const unit = weight[2]?.toLowerCase()
    if (unit !== 'dwt') parts.push(`weight_grams.eq.${n}`)
    if (!unit || unit === 'dwt') parts.push(`weight_dwt.eq.${n}`)
  }

  return parts.join(',')
}

/** The filters for a whole search: apply each with `.or()`. */
export function inventorySearchFilters(q: string): string[] {
  return searchWords(q).map(wordFilter)
}
