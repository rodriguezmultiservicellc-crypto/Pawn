/**
 * New pawn ticket: an item's description, written from its fields.
 *
 * The clerk fills value, color, metal, karat, weight… and the description
 * line writes itself ("14K yellow gold men's cuban link chain, 5.2 g").
 *
 * ALWAYS IN ENGLISH, whatever language the clerk's screen is in: Fla. Stat.
 * § 539.001(8)(a) — the pawnbroker's entries "must be typed or written
 * indelibly and legibly in English" (2026 edition, read 2026-11-24). So the
 * word order and the small words are constants here, not dictionary keys,
 * and the caller passes the item / metal / coating words from the ENGLISH
 * dictionary.
 *
 * Returns '' when there is nothing to describe yet — a category alone is
 * not a description.
 */

import { purityText } from '@/lib/spot-prices/purity'

export type ItemDescriptionKind =
  | 'jewelry'
  | 'firearms'
  | 'electronics'
  | 'tools'
  | 'other'

/** Who a piece of jewelry is made for (patches/0106). */
export const JEWELRY_GENDERS = ['men', 'women', 'unisex', 'child'] as const
export type JewelryGender = (typeof JEWELRY_GENDERS)[number]

/** The gender as it reads inside the description. */
const GENDER_WORDS: Readonly<Record<JewelryGender, string>> = {
  men: "men's",
  women: "women's",
  unisex: 'unisex',
  child: "child's",
}

export type ItemDescriptionInput = {
  kind: ItemDescriptionKind
  /** "Chain", "Ring"… in English; '' when not known. */
  itemWord: string
  /** A ring: a size typed as "7" reads "size 7". */
  isRing: boolean
  /** A chain, necklace or bracelet: a length typed as "22" reads "22 in". */
  isLength: boolean
  /** The color as saved (English when picked from the list). */
  color: string
  /** "Gold", "Silver"… in English; '' for none / other / not picked. */
  metalWord: string
  /** The metal as saved ('gold', 'silver'…): says whether `karat` is
   *  karats ("14K") or parts per thousand ("925"). */
  metal: string
  karat: string
  weightGrams: string
  /** Ring size or length (jewelry), or the size of anything else. */
  size: string
  /** "Gold plated"… in English; '' when the piece is solid. */
  coatingWord: string
  /** The stones as one line (lib/pawn/stones gemstoneText). */
  gemstones: string
  gender: JewelryGender | ''
  /** "Cuban link", "Solitaire"… as saved. */
  style: string
  /** A watch's or signed piece's brand and model, as typed. */
  jewelryBrand: string
  jewelryModel: string
  firearmMake: string
  firearmModel: string
  firearmCaliber: string
  /** "Handgun"… in English; '' when not picked. */
  firearmTypeWord: string
  firearmFinish: string
  electronicBrand: string
  electronicModel: string
  toolBrand: string
  toolModel: string
  /** An item in a category with no fields of its own. */
  generalBrand: string
  generalModel: string
}

const clean = (s: string) => s.trim().replace(/\s+/g, ' ')

/** Lower case, but an all-capitals word (PVD, LED) is left as it is. */
function lower(s: string): string {
  return clean(s)
    .split(' ')
    .map((w) => (w.length > 1 && w === w.toUpperCase() && /\p{L}/u.test(w) ? w : w.toLowerCase()))
    .join(' ')
}

function capFirst(s: string): string {
  return s === '' ? s : s.charAt(0).toUpperCase() + s.slice(1)
}

function joinParts(parts: ReadonlyArray<string>): string {
  return capFirst(parts.filter((p) => p !== '').join(', '))
}

function weightText(weight: string): string {
  const w = clean(weight)
  if (w === '' || !(parseFloat(w) > 0)) return ''
  return `${w} g`
}

const BARE_NUMBER = /^\d+([.,]\d+)?$/

/** The kinds of jewelry (inventory_category) whose Size / Length is a length. */
const LENGTH_KINDS: ReadonlySet<string> = new Set(['chain', 'necklace', 'bracelet'])

/** A chain, necklace or bracelet: its Size / Length is how long it is. */
export function isLengthPiece(category: string | null | undefined): boolean {
  return LENGTH_KINDS.has(category ?? '')
}

/**
 * A length as it is written: a bare number is inches ("22" → "22 in"); one
 * typed with its own unit or words ("55 cm", '22"', "22 in") is left alone.
 * The saved value stays as the clerk typed it — this is only how the
 * description and the printed ticket read it.
 */
export function lengthText(length: string | null | undefined): string {
  const l = clean(length ?? '')
  return BARE_NUMBER.test(l) ? `${l} in` : l
}

function jewelry(i: ItemDescriptionInput): string {
  // "14K yellow gold…", "925 silver…".
  const karat = purityText(i.metal, clean(i.karat))
  const color = lower(i.color)
  const metal = lower(i.metalWord)
  const sizeRaw = clean(i.size)
  const size =
    sizeRaw !== '' && i.isRing && BARE_NUMBER.test(sizeRaw)
      ? `size ${sizeRaw}`
      : i.isLength
        ? lengthText(sizeRaw)
        : sizeRaw
  // Same order as the fields on the screen: weight, size, coating, stones.
  const details = [weightText(i.weightGrams), size, lower(i.coatingWord), clean(i.gemstones)]

  const gender = i.gender === '' ? '' : GENDER_WORDS[i.gender]
  const style = lower(i.style)
  // Brand and model lead, as typed: "Rolex Submariner 16610, …".
  const brand = clean(`${i.jewelryBrand} ${i.jewelryModel}`)

  // The item word alone ("Chain") says nothing the category does not.
  const anything =
    karat !== '' ||
    color !== '' ||
    metal !== '' ||
    gender !== '' ||
    style !== '' ||
    brand !== '' ||
    details.some((d) => d !== '')
  if (!anything) return ''

  // "14K yellow gold men's cuban link chain"
  const head = clean([karat, color, metal, gender, style, lower(i.itemWord)].join(' '))
  return joinParts([brand, head, ...details])
}

/** Brand + model, then size and color: "Samsung UN55, 55 in, black". */
function brandModel(brand: string, model: string, size: string, color: string): string {
  const head = clean(`${brand} ${model}`)
  if (head === '') return ''
  return joinParts([head, clean(size), lower(color)])
}

function firearm(i: ItemDescriptionInput): string {
  const head = clean(`${i.firearmMake} ${i.firearmModel}`)
  const kind = clean(`${clean(i.firearmCaliber)} ${lower(i.firearmTypeWord)}`)
  if (head === '' && kind === '') return ''
  return joinParts([head, kind, lower(i.firearmFinish), lower(i.color)])
}

export function generateItemDescription(input: ItemDescriptionInput): string {
  switch (input.kind) {
    case 'jewelry':
      return jewelry(input)
    case 'firearms':
      return firearm(input)
    case 'electronics':
      return brandModel(input.electronicBrand, input.electronicModel, input.size, input.color)
    case 'tools':
      return brandModel(input.toolBrand, input.toolModel, input.size, input.color)
    default:
      return brandModel(input.generalBrand, input.generalModel, input.size, input.color)
  }
}

/**
 * The description after a field changed.
 *
 * It follows the fields only while the clerk has left it alone: empty, or
 * still exactly what was written for them before the change. Once they type
 * their own words it is theirs — clearing it hands it back.
 */
export function descriptionAfterChange(
  current: string,
  generatedBefore: string,
  generatedAfter: string,
): string {
  if (generatedAfter === generatedBefore) return current
  const untouched = current.trim() === '' || current === generatedBefore
  return untouched ? generatedAfter : current
}
