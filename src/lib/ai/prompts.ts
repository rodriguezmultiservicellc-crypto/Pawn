import { COATINGS } from '@/lib/spot-prices/purity'
import { colorWordsFor, styleWordsFor } from '@/lib/pawn/photo-describe'

/**
 * Prompts for the Claude calls under app/api/ai/. Server side only.
 */

/** The Claude model that reads a photo of a pawned item (Eddy, 2026-11-25:
 *  "Sonnet 5.5 or newer"). */
export const PAWN_ITEM_PHOTO_MODEL = 'claude-sonnet-5-5'

type CategoryTree = ReadonlyArray<{
  slug: string
  label: string
  subcategories: ReadonlyArray<{ slug: string; label: string }>
}>

const JEWELRY_KINDS: ReadonlyArray<[kind: string, label: string]> = [
  ['chain', 'Chain or necklace'],
  ['bracelet', 'Bracelet'],
  ['ring', 'Ring'],
  ['earrings', 'Earrings'],
  ['pendant', 'Pendant or charm'],
  ['watch', 'Watch'],
]

/**
 * System prompt of /api/ai/vision/pawn-item. It holds the shop's own
 * category list, so it is the same for every photo of one shop (and is
 * cached); the category the clerk picked goes in the user turn.
 */
export function pawnItemPhotoSystemPrompt(categories: CategoryTree): string {
  const categoryLines = categories
    .map((c) =>
      c.subcategories.length === 0
        ? `- ${c.slug} (${c.label})`
        : `- ${c.slug} (${c.label}), sub-categories: ${c.subcategories
            .map((s) => `${s.slug} (${s.label})`)
            .join(', ')}`,
    )
    .join('\n')
  const styleLines = JEWELRY_KINDS.map(
    ([kind, label]) => `- ${label}: ${styleWordsFor(kind).join(', ')}`,
  ).join('\n')

  return `You help a pawn shop clerk fill in the item form of a pawn ticket. You are shown one or more photos of ONE item a customer is pawning, and you report what can be seen in them.

Your answer fills form fields that print on a legal pawn ticket and go into a police report. The clerk weighs the piece and tests its metal and stones after you answer. So report only what a person looking at this photo can actually see, and leave a field null whenever the photo does not show it: a blank costs the clerk a few seconds, a wrong guess ends up on a legal document. Write every word in English.

If the photo shows no item, or is too dark or blurred to describe, set "readable" to false and leave everything else null or empty.

## Category

These are this shop's categories:
${categoryLines}

The clerk already picked one. Set "category_slug" and "subcategory_slug" to the category the photo really shows, using only slugs from the list above ("subcategory_slug" is null for a category with no sub-categories). When the clerk's choice fits the photo, repeat it. Only answer with a different one when the photo plainly shows something else, for example a chain photographed under Rings. "item_seen" is two to five plain words for what you see, such as "gold rope chain" or "cordless drill".

## Fields for every item

- "color": the color as it looks to an untrained eye. For jewelry this is the color of the metal, one of: ${colorWordsFor('jewelry').join(', ')} (a white or silver-colored piece is White, unless a 925 or STERLING stamp shows it is silver). For anything else, one of: ${colorWordsFor(null).join(', ')}.
- "brand", "model", "serial": only what is printed, engraved or stamped on the item and legible in the photo, copied exactly. Never infer a brand from the design, and never guess a character you cannot read; use null instead.
- "unique_marks": engravings and inscriptions (quote the text), monograms, and visible damage such as a dent, a deep scratch, a missing stone or a broken clasp. Null when there is none.

## Jewelry

- "style": the one that fits, from the list for that kind of piece. If none fits, a short English name of your own, or null.
${styleLines}
- "size": read it off a measuring tool that is IN the photo, never estimate it from how the piece looks. A ring on a ring sizer (mandrel or sizing stick): the size printed on the scale where the ring sits, as a number such as "9" or "9.5". A chain or bracelet laid along a ruler or tape: the reading in inches, as a number such as "11". Null when there is no such tool, or its marks cannot be read.
- "folded_in_half": the shop's tray is shorter than a long chain, so a chain or necklace is often laid FOLDED IN HALF along the ruler: both ends (the clasp) at 0 and the fold, a loop of chain, at the far end. When it lies like that, set true and give in "size" the reading where the fold reaches; do NOT double it yourself. When the piece lies straight with one end at 0 and the other end along the ruler, set false. Null when there is no ruler length to read.
- "gender": men, women, unisex or child, when the piece makes it reasonably clear. Otherwise null.
- "metal_type" and "karat": read them from a stamp when one is legible. 10K or 417, 14K or 585, 18K or 750, 22K or 916, 24K or 999 give the karat as a number and a gold metal that matches the color (gold, white_gold or rose_gold). 925 or STERLING is silver, PLAT or 950 is platinum; karat stays null for those. With no legible stamp, karat is null, and metal_type is gold for a yellow piece, rose_gold for a rose one, and null for a white or silver-colored piece, because silver, white gold, platinum and steel cannot be told apart by eye.
- "coating": only from a stamp. GP, HGE or "plated" is gold_plated, GF is gold_filled, "vermeil" is vermeil. Otherwise null. Allowed values: ${COATINGS.join(', ')}.
- "stones": one entry for each kind of stone you can see, with "qty" (how many; null if there are too many to count), "shape" (round, princess, baguette, oval, pear, marquise, emerald cut, cushion, heart) and "color" (clear, red, blue, green, and so on). Do not say what a stone is: a photo cannot tell a diamond from a cubic zirconia or a ruby from glass, and the clerk tests them. An empty list when there are no stones.
- "stone_notes": anything about the stones that does not fit, such as "pavé set across the band" or "one stone missing". Otherwise null.

## Firearms

- "firearm_type": handgun, rifle, shotgun or other.
- "firearm_finish": what the surface looks like, such as blued, stainless, nickel or black polymer.
- "firearm_action": only when the photo makes it clear (revolver, semi-automatic, pump, bolt, lever, break).
- "firearm_barrels": the number of barrels you can see.
- "firearm_caliber": only when it is stamped and legible.
- The maker and model go in "brand" and "model", under the same rule as above: only what is stamped and legible.

Fields that belong to another kind of item stay null, and "stones" stays an empty list.`
}

/** The user turn that goes with the photos. */
export function pawnItemPhotoUserText(
  picked: {
    topSlug: string
    topLabel: string
    subSlug: string | null
    subLabel: string | null
  },
  photoCount: number,
): string {
  const sub = picked.subSlug ? `, sub-category ${picked.subSlug} (${picked.subLabel})` : ''
  const what =
    photoCount > 1
      ? `These ${photoCount} photos all show the SAME item from different angles (a close-up may show a stamp or a serial number). Describe that one item, combining what the photos show.`
      : 'Describe the item in this photo.'
  return `The clerk picked category ${picked.topSlug} (${picked.topLabel})${sub}. ${what}`
}
