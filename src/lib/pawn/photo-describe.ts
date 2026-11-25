import { z } from 'zod'
import { en } from '@/lib/i18n/en'
import { Constants } from '@/types/database'
import type { MetalType } from '@/types/database-aliases'
import { COATINGS, type Coating } from '@/lib/spot-prices/purity'
import { JEWELRY_GENDERS, type JewelryGender } from './item-description'
import {
  GENERAL_COLOR_KEYS,
  JEWELRY_COLOR_KEYS,
  styleKeysFor,
} from './item-options'
import { MAX_STONES, type StoneDraft } from './stones'

/**
 * "Describe from photo" in the New pawn ticket item popup (Eddy, 2026-11-25).
 *
 * The clerk's photo of the item goes to /api/ai/vision/pawn-item, which
 * answers with a PhotoItem: what a person can SEE in the photo. This file is
 * the pure half — the shape of that answer, and how it becomes the popup's
 * fields — shared by the route, the popup and the tests.
 *
 * What the photo reader may and may not say (the prompt in
 * lib/ai/prompts.ts asks for this; the mapper here enforces it):
 * - Never a weight, a value, a carat weight or a clarity.
 * - A karat only when a stamp is legible (the route trusts the model on
 *   that; anything outside 1-24 is dropped here).
 * - NEVER what a stone is. A photo cannot tell a diamond from a cubic
 *   zirconia, and the ticket would say "diamond". Every stone line is
 *   written as Cubic zirconia with its count, shape and color; the clerk
 *   changes it after testing (Eddy: "skip the type of stones, all cz").
 * - Words that are saved are English (rule 27): a color or style that is
 *   one of the shop's choices is saved as that choice's English word.
 */

const FIREARM_TYPES = ['handgun', 'rifle', 'shotgun', 'other'] as const

const text = z.string().nullable()

/** What the model answers. Every field it cannot see is null. */
export const PhotoItemSchema = z.object({
  /** false when the photo shows no item, or is too dark / blurred to read. */
  readable: z.boolean(),
  /** A few plain English words for what the photo shows: "gold rope chain". */
  item_seen: z.string(),
  /** The shop's category the photo belongs to (pawn_intake_categories.slug). */
  category_slug: text,
  subcategory_slug: text,
  color: text,
  unique_marks: text,
  brand: text,
  model: text,
  serial: text,
  metal_type: z.enum(Constants.public.Enums.metal_type).nullable(),
  karat: z.number().nullable(),
  coating: z.enum(COATINGS).nullable(),
  gender: z.enum(JEWELRY_GENDERS).nullable(),
  style: text,
  /** Read off a measuring tool in the photo, never guessed: a ring size from
   *  a ring sizer / mandrel ("9", "9.5"), a length in inches from a ruler or
   *  tape ("22"). */
  size: text,
  stones: z.array(
    z.object({
      qty: z.number().nullable(),
      shape: text,
      color: text,
    }),
  ),
  stone_notes: text,
  firearm_type: z.enum(FIREARM_TYPES).nullable(),
  firearm_caliber: text,
  firearm_finish: text,
  firearm_action: text,
  firearm_barrels: z.number().nullable(),
})

export type PhotoItem = z.infer<typeof PhotoItemSchema>

/** The popup fields a photo can fill. Keys are the popup row's own. */
export type PhotoItemPatch = Partial<{
  color: string
  unique_marks: string
  metal_type: MetalType | ''
  karat: string
  coating: Coating
  jewelry_size: string
  item_size: string
  jewelry_gender: JewelryGender | ''
  jewelry_style: string
  jewelry_brand: string
  jewelry_model: string
  jewelry_serial: string
  stones: StoneDraft[]
  gemstone_notes: string
  firearm_make: string
  firearm_model: string
  firearm_serial_number: string
  firearm_caliber: string
  firearm_type: (typeof FIREARM_TYPES)[number]
  firearm_action_type: string
  firearm_finish: string
  firearm_number_of_barrels: string
  electronic_brand: string
  electronic_model: string
  electronic_serial: string
  tool_brand: string
  tool_model: string
  tool_serial: string
  general_brand: string
  general_model: string
  general_serial: string
}>

const clean = (v: string | null | undefined, max: number): string =>
  (v ?? '').trim().replace(/\s+/g, ' ').slice(0, max)

/** The English words of a list of dictionary keys. */
function words<K extends string>(
  keys: ReadonlyArray<K>,
  dict: Readonly<Record<K, string>>,
): string[] {
  return keys.map((k) => dict[k])
}

/** The shop's word when `value` is one of them (any letter case), else the
 *  value as it came. */
function asChoice(value: string, choices: ReadonlyArray<string>): string {
  const v = value.toLowerCase()
  return choices.find((c) => c.toLowerCase() === v) ?? value
}

/** The Color choices of an item, in English: jewelry has its own list. */
export function colorWordsFor(topSlug: string | null): string[] {
  return words(
    topSlug === 'jewelry' ? JEWELRY_COLOR_KEYS : GENERAL_COLOR_KEYS,
    en.pawn.new_.colors,
  )
}

/** The Style choices of a kind of jewelry (inventory_category), in English. */
export function styleWordsFor(inventoryCategory: string): string[] {
  return words(styleKeysFor(inventoryCategory), en.pawn.new_.styles)
}

/** The yellow-gold a jewelry piece starts on is only right for a yellow or
 *  rose piece. */
const GOLD_BY_EYE = new Set(['yellow', 'rose', 'two-tone', 'tri-color'])

/**
 * The popup fields a photo's answer fills, for an item of this category.
 * A field the photo did not show is not in the patch — the popup keeps what
 * the clerk has there.
 *
 * One exception, jewelry metal: a piece starts on Gold. When the photo shows
 * a piece that is not yellow or rose and no stamp says what it is, the metal
 * is emptied — "white" could be silver, white gold, platinum or steel, and
 * the clerk must pick.
 */
export function photoItemPatch(
  item: PhotoItem,
  topSlug: string | null,
  inventoryCategory: string,
): PhotoItemPatch {
  const patch: PhotoItemPatch = {}

  const color = clean(item.color, 40)
  if (color) patch.color = asChoice(color, colorWordsFor(topSlug))
  const marks = clean(item.unique_marks, 300)
  if (marks) patch.unique_marks = marks

  const brand = clean(item.brand, 80)
  const model = clean(item.model, 80)
  const serial = clean(item.serial, 80)
  // A bare number: the description adds "size" for a ring and "in" for a
  // chain (lib/pawn/item-description), so the unit is not written here.
  const size = clean(item.size, 20).replace(/^size\s+/i, '').replace(/\s*(in|inch|inches|")$/i, '')

  if (topSlug === 'jewelry') {
    if (size) patch.jewelry_size = size
    if (brand) patch.jewelry_brand = brand
    if (model) patch.jewelry_model = model
    if (serial) patch.jewelry_serial = serial

    if (item.metal_type) patch.metal_type = item.metal_type
    else if (color && !GOLD_BY_EYE.has(color.toLowerCase())) patch.metal_type = ''
    if (item.karat != null && item.karat >= 1 && item.karat <= 24) {
      patch.karat = String(Math.round(item.karat * 2) / 2)
    }
    if (item.coating && item.coating !== 'none') patch.coating = item.coating
    if (item.gender) patch.jewelry_gender = item.gender
    const style = clean(item.style, 60)
    if (style) patch.jewelry_style = asChoice(style, styleWordsFor(inventoryCategory))

    const stones: StoneDraft[] = []
    for (const s of item.stones) {
      const shape = clean(s.shape, 40)
      const stoneColor = clean(s.color, 40)
      const qty = s.qty != null && s.qty >= 1 ? String(Math.min(9999, Math.round(s.qty))) : ''
      if (!qty && !shape && !stoneColor) continue
      stones.push({
        qty,
        // Never what the photo "looks like" — see the header.
        type: en.pawn.new_.stoneTypes.cubic_zirconia,
        carat: '',
        color: stoneColor,
        cut: shape,
        clarity: '',
      })
      if (stones.length === MAX_STONES) break
    }
    if (stones.length > 0) patch.stones = stones
    const notes = clean(item.stone_notes, 300)
    if (notes) patch.gemstone_notes = notes
    return patch
  }

  if (topSlug === 'firearms') {
    if (brand) patch.firearm_make = brand
    if (model) patch.firearm_model = model
    if (serial) patch.firearm_serial_number = serial
    if (item.firearm_type) patch.firearm_type = item.firearm_type
    const caliber = clean(item.firearm_caliber, 40)
    if (caliber) patch.firearm_caliber = caliber
    const finish = clean(item.firearm_finish, 60)
    if (finish) patch.firearm_finish = finish
    const action = clean(item.firearm_action, 60)
    if (action) patch.firearm_action_type = action
    if (item.firearm_barrels != null && item.firearm_barrels >= 1 && item.firearm_barrels <= 20) {
      patch.firearm_number_of_barrels = String(Math.round(item.firearm_barrels))
    }
    return patch
  }

  if (size) patch.item_size = size
  const prefix = topSlug === 'electronics' ? 'electronic' : topSlug === 'tools' ? 'tool' : 'general'
  if (brand) patch[`${prefix}_brand`] = brand
  if (model) patch[`${prefix}_model`] = model
  if (serial) patch[`${prefix}_serial`] = serial
  return patch
}

type CategoryTree = ReadonlyArray<{
  slug: string
  subcategories: ReadonlyArray<{ slug: string }>
}>

/**
 * The category the photo belongs to, when the answer names one that exists
 * in this shop: a top-level category, with one of ITS sub-categories when it
 * has any. Anything else — a made-up slug, a sub of another category, a top
 * that needs a sub and got none — is null: no suggestion.
 */
export function seenCategory(
  item: Pick<PhotoItem, 'category_slug' | 'subcategory_slug'>,
  categories: CategoryTree,
): { top: string; sub: string | null } | null {
  const top = categories.find((c) => c.slug === item.category_slug)
  if (!top) return null
  if (top.subcategories.length === 0) return { top: top.slug, sub: null }
  const sub = top.subcategories.find((s) => s.slug === item.subcategory_slug)
  return sub ? { top: top.slug, sub: sub.slug } : null
}
