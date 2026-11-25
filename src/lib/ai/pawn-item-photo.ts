import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { PhotoItemSchema, type PhotoItem } from '@/lib/pawn/photo-describe'
import {
  PAWN_ITEM_PHOTO_MODEL,
  pawnItemPhotoSystemPrompt,
  pawnItemPhotoUserText,
} from './prompts'

/**
 * SERVER ONLY. The Claude call behind /api/ai/vision/pawn-item: one photo of
 * a pawned item + the category the clerk picked → what can be seen in it.
 * The route does the gates and the file checks; this is the call alone, so
 * it can be run against real photos without a signed-in browser.
 */

export type PawnItemPhotoImageType = 'image/jpeg' | 'image/png' | 'image/webp'

type CategoryTree = ReadonlyArray<{
  slug: string
  label: string
  subcategories: ReadonlyArray<{ slug: string; label: string }>
}>

export type PawnItemPhotoResult =
  | { ok: true; item: PhotoItem }
  | { ok: false; error: 'busy' | 'failed' }

export async function describePawnItemPhoto(args: {
  apiKey: string
  categories: CategoryTree
  picked: { topSlug: string; topLabel: string; subSlug: string | null; subLabel: string | null }
  mime: PawnItemPhotoImageType
  bytes: Buffer
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
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: args.mime,
                data: args.bytes.toString('base64'),
              },
            },
            { type: 'text', text: pawnItemPhotoUserText(args.picked) },
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
    return item ? { ok: true, item } : { ok: false, error: 'failed' }
  } catch (e) {
    console.error('[vision/pawn-item] claude failed', e)
    if (e instanceof Anthropic.RateLimitError) return { ok: false, error: 'busy' }
    return { ok: false, error: 'failed' }
  }
}
