import { NextRequest, NextResponse } from 'next/server'
import { pawnIntakeGate } from '@/lib/ai/pawn-intake-gate'
import {
  describePawnItemPhoto,
  type PawnItemPhotoImageType,
} from '@/lib/ai/pawn-item-photo'
import { loadPawnIntakeCategories } from '@/lib/pawn/intake-categories'
import { seenCategory } from '@/lib/pawn/photo-describe'
import { prepareUpload } from '@/lib/uploads/convert'
import { resolveUploadMime } from '@/lib/uploads/mime'

export const runtime = 'nodejs'
// One photo takes a few seconds; leave room for a slow answer.
export const maxDuration = 60

/**
 * "Describe from photo" in the New pawn ticket item popup.
 *
 * The clerk's photo of ONE item + the category they picked go to Claude,
 * which answers what can be seen: color, style, stamps, brand, marks, how
 * many stones — and which of the shop's categories the photo really shows.
 * Nothing is saved here: the answer fills the popup's fields and the clerk
 * checks them before the item is added (rule 7 — nothing AI-written reaches
 * a ticket without staff looking at it).
 *
 * What the model may say, and what it never says (a weight, a value, what a
 * stone is), is in lib/pawn/photo-describe + lib/ai/prompts.
 *
 * Errors are CODES; the popup shows its own translated text for each.
 *
 * Cost (rough): one ~2000 px photo + a short answer on Sonnet 5.5 ≈ 1-2 cents.
 */

const IMAGE_TYPES: ReadonlyArray<PawnItemPhotoImageType> = [
  'image/jpeg',
  'image/png',
  'image/webp',
]
const isImageType = (m: string): m is PawnItemPhotoImageType =>
  (IMAGE_TYPES as ReadonlyArray<string>).includes(m)

// The browser sends a photo already shrunk to a few hundred KB
// (lib/uploads/fit-photo); the API takes 5 MB per image.
const MAX_PHOTO_BYTES = 5 * 1024 * 1024

type ErrorCode =
  | 'not_configured'
  | 'bad_request'
  | 'photo_type'
  | 'photo_too_large'
  | 'unreadable'
  | 'busy'
  | 'failed'

function bad(status: number, error: ErrorCode) {
  return NextResponse.json({ error }, { status })
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return bad(503, 'not_configured')

  const gate = await pawnIntakeGate()
  if (!gate.ok) return gate.response

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return bad(400, 'bad_request')
  }
  const photo = formData.get('photo')
  const topSlug = String(formData.get('pawn_category') ?? '')
  const subSlug = String(formData.get('pawn_subcategory') ?? '') || null
  if (!(photo instanceof File) || photo.size === 0) return bad(400, 'bad_request')
  if (photo.size > MAX_PHOTO_BYTES) return bad(413, 'photo_too_large')

  // The category the clerk picked must be one of this shop's.
  const categories = await loadPawnIntakeCategories(
    gate.ctx.supabase,
    gate.tenantId,
    gate.hasFirearms,
  )
  const top = categories.find((c) => c.slug === topSlug)
  if (!top) return bad(400, 'bad_request')
  const sub = subSlug ? top.subcategories.find((s) => s.slug === subSlug) ?? null : null

  // HEIC the browser could not convert becomes JPEG here.
  const declared = resolveUploadMime(photo)
  if (declared !== 'image/heic' && !isImageType(declared)) return bad(415, 'photo_type')
  const prepared = await prepareUpload(photo, declared)
  if (!isImageType(prepared.mime)) return bad(415, 'photo_type')
  const bytes =
    prepared.body instanceof File
      ? Buffer.from(await prepared.body.arrayBuffer())
      : prepared.body

  const result = await describePawnItemPhoto({
    apiKey,
    categories,
    picked: {
      topSlug: top.slug,
      topLabel: top.label,
      subSlug: sub?.slug ?? null,
      subLabel: sub?.label ?? null,
    },
    mime: prepared.mime,
    bytes,
  })
  if (!result.ok) return bad(result.error === 'busy' ? 503 : 502, result.error)
  if (!result.item.readable) return bad(422, 'unreadable')

  return NextResponse.json({
    data: {
      item: result.item,
      // Null when the answer names no category this shop has.
      category: seenCategory(result.item, categories),
    },
  })
}
