/**
 * New pawn ticket: an item's description, written from its fields.
 *
 * The clerk fills value, color, metal, karat, weight… and the description
 * line writes itself ("14K yellow gold chain, 5.2 g, 22 in"). Pure: the
 * caller passes the words in the clerk's language, so the same function
 * serves English and Spanish.
 *
 * Returns '' when there is nothing to describe yet — a category alone is
 * not a description.
 */

export type ItemDescriptionKind =
  | 'jewelry'
  | 'firearms'
  | 'electronics'
  | 'tools'
  | 'other'

/** Who a piece of jewelry is made for (patches/0106). */
export const JEWELRY_GENDERS = ['men', 'women', 'unisex', 'child'] as const
export type JewelryGender = (typeof JEWELRY_GENDERS)[number]

export type ItemDescriptionWords = {
  /** Word order of a jewelry piece, with the tokens {karat} {color}
   *  {metal} {gender} {style} {item}. English:
   *  "{karat} {color} {metal} {gender} {style} {item}"; Spanish:
   *  "{item} {style} {gender} {metal} {color} {karat}". */
  jewelryOrder: string
  /** A ring's size typed as a bare number: "size {v}". */
  ringSize: string
}

export type ItemDescriptionInput = {
  kind: ItemDescriptionKind
  /** "Chain", "Ring"… in the clerk's language; '' when not known. */
  itemWord: string
  /** A ring: a size typed as "7" reads "size 7". */
  isRing: boolean
  color: string
  /** "Gold", "Silver"… ; '' for none / other / not picked. */
  metalWord: string
  karat: string
  weightGrams: string
  size: string
  /** "Gold plated"… ; '' when the piece is solid. */
  coatingWord: string
  /** The stones as one line (lib/pawn/stones gemstoneText). */
  gemstones: string
  /** "men's" / "de hombre"… as it reads inside a sentence; '' when not picked. */
  genderWord: string
  /** "Cuban link", "Solitaire"… as typed. */
  style: string
  /** A watch's or signed piece's brand and model, as typed. */
  jewelryBrand: string
  jewelryModel: string
  firearmMake: string
  firearmModel: string
  firearmCaliber: string
  /** "Handgun"… ; '' when not picked. */
  firearmTypeWord: string
  firearmFinish: string
  electronicBrand: string
  electronicModel: string
  toolBrand: string
  toolModel: string
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

function karatText(karat: string): string {
  const k = clean(karat)
  if (k === '' || !(parseFloat(k) > 0)) return ''
  return `${k}K`
}

function weightText(weight: string): string {
  const w = clean(weight)
  if (w === '' || !(parseFloat(w) > 0)) return ''
  return `${w} g`
}

function jewelry(i: ItemDescriptionInput, words: ItemDescriptionWords): string {
  const karat = karatText(i.karat)
  const color = lower(i.color)
  const metal = lower(i.metalWord)
  const sizeRaw = clean(i.size)
  const size =
    sizeRaw !== '' && i.isRing && /^\d+([.,]\d+)?$/.test(sizeRaw)
      ? words.ringSize.replace('{v}', sizeRaw)
      : sizeRaw
  // Same order as the fields on the screen: weight, size, coating, stones.
  const details = [weightText(i.weightGrams), size, lower(i.coatingWord), clean(i.gemstones)]

  const gender = clean(i.genderWord)
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

  const head = clean(
    words.jewelryOrder
      .replace('{karat}', karat)
      .replace('{color}', color)
      .replace('{metal}', metal)
      .replace('{gender}', gender)
      .replace('{style}', style)
      .replace('{item}', lower(i.itemWord)),
  )
  return joinParts([brand, head, ...details])
}

/** Brand + model, then the color: "Apple iPhone 13 Pro, black". */
function brandModel(brand: string, model: string, color: string): string {
  const head = clean(`${brand} ${model}`)
  if (head === '') return ''
  return joinParts([head, lower(color)])
}

function firearm(i: ItemDescriptionInput): string {
  const head = clean(`${i.firearmMake} ${i.firearmModel}`)
  const kind = clean(`${clean(i.firearmCaliber)} ${lower(i.firearmTypeWord)}`)
  if (head === '' && kind === '') return ''
  return joinParts([head, kind, lower(i.firearmFinish), lower(i.color)])
}

export function generateItemDescription(
  input: ItemDescriptionInput,
  words: ItemDescriptionWords,
): string {
  switch (input.kind) {
    case 'jewelry':
      return jewelry(input, words)
    case 'firearms':
      return firearm(input)
    case 'electronics':
      return brandModel(input.electronicBrand, input.electronicModel, input.color)
    case 'tools':
      return brandModel(input.toolBrand, input.toolModel, input.color)
    default:
      return ''
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
