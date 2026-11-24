/**
 * The choices behind the Color and Style dropdowns of the item popup.
 *
 * Also the Stone dropdown of each stone line.
 *
 * Only KEYS live here. The words are in the dictionary
 * (pawn.new_.colors / styles / stoneTypes): the clerk reads them in their own
 * language, and what is SAVED is always the English word — Fla. Stat.
 * § 539.001(8)(a) wants the form's entries "in English", and the columns
 * (color, jewelry_style) are free text, so an older or imported value
 * ("Yellow Gold") and anything typed under "Other" still fit.
 */

/** A piece of jewelry: the color of its metal. */
export const JEWELRY_COLOR_KEYS = [
  'yellow',
  'white',
  'rose',
  'two_tone',
  'tri_color',
  'silver',
  'black',
] as const

/** Everything else: the color "as apparent to the untrained eye". */
export const GENERAL_COLOR_KEYS = [
  'black',
  'white',
  'silver',
  'gray',
  'gold',
  'red',
  'blue',
  'green',
  'brown',
  'tan',
  'orange',
  'yellow',
  'pink',
  'purple',
  'multicolor',
] as const

/** What a stone is (FS 539.001(8)(b)2.g, "gemstone description"). Lab-grown
 *  and look-alikes have their own line: they lend at a fraction of a mined
 *  diamond, and the ticket must say which it is. */
export const STONE_TYPE_KEYS = [
  'diamond',
  'lab_diamond',
  'moissanite',
  'cubic_zirconia',
  'ruby',
  'sapphire',
  'emerald',
  'amethyst',
  'aquamarine',
  'topaz',
  'garnet',
  'opal',
  'pearl',
  'peridot',
  'citrine',
  'tanzanite',
  'tourmaline',
  'onyx',
  'jade',
  'turquoise',
] as const

const CHAIN_STYLES = [
  'cuban_link',
  'figaro',
  'rope',
  'box',
  'franco',
  'curb',
  'mariner',
  'herringbone',
  'snake',
  'wheat',
  'byzantine',
  'singapore',
  'bismark',
  'bead',
  'cable',
  'tennis',
] as const

const BRACELET_STYLES = [
  'cuban_link',
  'figaro',
  'rope',
  'curb',
  'mariner',
  'herringbone',
  'bismark',
  'tennis',
  'bangle',
  'cuff',
  'id_bracelet',
  'charm_bracelet',
  'nugget',
] as const

const RING_STYLES = [
  'band',
  'wedding_band',
  'solitaire',
  'cluster',
  'halo',
  'three_stone',
  'signet',
  'nugget',
  'class_ring',
  'eternity',
  'dome',
  'cocktail',
] as const

const EARRING_STYLES = ['stud', 'hoop', 'huggie', 'dangle', 'cluster'] as const

const PENDANT_STYLES = [
  'cross',
  'crucifix',
  'religious_medal',
  'medallion',
  'nameplate',
  'heart',
  'initial',
  'charm',
  'locket',
  'nugget',
  'coin_pendant',
] as const

const WATCH_STYLES = ['dress', 'sport', 'chronograph', 'diver', 'digital', 'pocket_watch'] as const

export type StyleKey =
  | (typeof CHAIN_STYLES)[number]
  | (typeof BRACELET_STYLES)[number]
  | (typeof RING_STYLES)[number]
  | (typeof EARRING_STYLES)[number]
  | (typeof PENDANT_STYLES)[number]
  | (typeof WATCH_STYLES)[number]

const BY_CATEGORY: Readonly<Record<string, ReadonlyArray<StyleKey>>> = {
  chain: CHAIN_STYLES,
  necklace: CHAIN_STYLES,
  bracelet: BRACELET_STYLES,
  ring: RING_STYLES,
  earrings: EARRING_STYLES,
  pendant: PENDANT_STYLES,
  watch: WATCH_STYLES,
}

/** Every style once, in the order the lists above name them. */
const ALL_STYLES: ReadonlyArray<StyleKey> = [
  ...new Set<StyleKey>([
    ...CHAIN_STYLES,
    ...BRACELET_STYLES,
    ...RING_STYLES,
    ...EARRING_STYLES,
    ...PENDANT_STYLES,
    ...WATCH_STYLES,
  ]),
]

/** The styles offered for a kind of jewelry (inventory_category). A kind
 *  with no list of its own — scrap, a coin, a loose stone — gets them all. */
export function styleKeysFor(category: string): ReadonlyArray<StyleKey> {
  return BY_CATEGORY[category] ?? ALL_STYLES
}

export type Choice = {
  /** What is saved: the English word. */
  value: string
  /** What the clerk reads. */
  label: string
}

/** Keys + the two dictionaries' words → the dropdown's choices. */
export function choicesFrom<K extends string>(
  keys: ReadonlyArray<K>,
  english: Readonly<Record<K, string>>,
  shown: Readonly<Record<K, string>>,
): Choice[] {
  return keys.map((k) => ({ value: english[k], label: shown[k] }))
}

/**
 * The choice a saved value stands for, or null when it is none of them —
 * then it is shown under "Other" exactly as it was saved. Upper and lower
 * case do not matter; neither does the language it was picked in.
 */
export function matchChoice(value: string, choices: ReadonlyArray<Choice>): Choice | null {
  const v = value.trim().toLowerCase()
  if (v === '') return null
  return (
    choices.find((c) => c.value.toLowerCase() === v) ??
    choices.find((c) => c.label.toLowerCase() === v) ??
    null
  )
}
