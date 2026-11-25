import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { PhotoItemSchema, type PhotoItem } from '@/lib/pawn/photo-describe'
import {
  PAWN_ITEM_PHOTO_MODEL,
  pawnItemPhotoSystemPrompt,
  pawnItemPhotoUserText,
} from './prompts'

/**
 * SERVER ONLY. The Claude call behind /api/ai/vision/pawn-item: the photos
 * of ONE pawned item + the category the clerk picked → what can be seen in
 * them. The route does the gates and fetches the photos; this is the call
 * alone, so it can be run against real photos without a signed-in browser.
 */

export type PawnItemPhotoImageType = 'image/jpeg' | 'image/png' | 'image/webp'

type CategoryTree = ReadonlyArray<{
  slug: string
  label: string
  subcategories: ReadonlyArray<{ slug: string; label: string }>
}>

export type PawnItemPhotoResult =
  | { ok: true; item: PhotoItem; usage: Anthropic.Usage }
  | { ok: false; error: 'busy' | 'failed' }

export async function describePawnItemPhoto(args: {
  apiKey: string
  categories: CategoryTree
  picked: { topSlug: string; topLabel: string; subSlug: string | null; subLabel: string | null }
  /** One or more photos of the SAME item, main first. */
  images: ReadonlyArray<{ mime: PawnItemPhotoImageType; bytes: Buffer }>
}): Promise<PawnItemPhotoResult> {
  const anthropic = new Anthropic({ apiKey: args.apiKey })
  try {
    const response = await anthropic.messages.parse({
      model: PAWN_ITEM_PHOTO_MODEL,
      max_tokens: 4096,
      // An extraction: little thinking, a quick answer for a waiting clerk.
      output_config: { effort: 'low', format: zodOutputFormat(PhotoItemSchema) },
      system: [
        {
          type: 'text',
          // The same for every photo of one shop: cached.
          text: pawnItemPhotoSystemPrompt(args.categories),
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: [
            ...args.images.map(
              (img): Anthropic.ImageBlockParam => ({
                type: 'image',
                source: { type: 'base64', media_type: img.mime, data: img.bytes.toString('base64') },
              }),
            ),
            { type: 'text', text: pawnItemPhotoUserText(args.picked, args.images.length) },
          ],
        },
      ],
    })

    // A decline or a cut-off answer does not match the schema: read neither.
    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') {
      console.error('[vision/pawn-item] no answer', response.stop_reason)
      return { ok: false, error: 'failed' }
    }
    const item = response.parsed_output
    return item ? { ok: true, item, usage: response.usage } : { ok: false, error: 'failed' }
  } catch (e) {
    console.error('[vision/pawn-item] claude failed', e)
    if (e instanceof Anthropic.RateLimitError) return { ok: false, error: 'busy' }
    return { ok: false, error: 'failed' }
  }
}
