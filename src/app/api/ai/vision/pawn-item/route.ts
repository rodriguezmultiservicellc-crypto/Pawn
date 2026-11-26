import { NextRequest, NextResponse } from 'next/server'
import { pawnIntakeGate } from '@/lib/ai/pawn-intake-gate'
import {
  describePawnItemPhoto,
  type PawnItemPhotoImageType,
} from '@/lib/ai/pawn-item-photo'
import { loadPawnIntakeCategories } from '@/lib/pawn/intake-categories'
import { seenCategory } from '@/lib/pawn/photo-describe'
import { createAdminClient } from '@/lib/supabase/admin'
import { prepareUpload } from '@/lib/uploads/convert'
import { INVENTORY_PHOTOS_BUCKET } from '@/lib/supabase/storage'
import {
  intakePhotoMime,
  parseIntakePhotoPaths,
} from '@/lib/uploads/intake-photos'

export const runtime = 'nodejs'
// A few photos take a few seconds; leave room for a slow answer.
export const maxDuration = 60

/**
 * "Describe from photo" in the New pawn ticket item popup.
 *
 * The item's photos (already in the shop's storage folder — the popup sends
 * their paths, lib/uploads/intake-photos) + the category the clerk picked go
 * to Claude, which answers what can be seen: color, style, stamps, brand,
 * marks, how many stones — and which of the shop's categories the item
 * really is. Nothing is saved here: the answer fills the popup's fields and
 * the clerk checks them before the item is added (rule 7 — nothing
 * AI-written reaches a ticket without staff looking at it).
 *
 * What the model may say, and what it never says (a value, what a stone is;
 * a weight only off a scale display in the photo), is in
 * lib/pawn/photo-describe + lib/ai/prompts. Every photo of the item goes in
 * one call, so a close-up of the stamp and a photo on the scale add up.
 *
 * Errors are CODES; the popup shows its own translated text for each.
 *
 * Cost (measured 2026-11-25, Sonnet 5.5): about 1 cent for one photo, about
 * half a cent more for each extra photo.
 */

const IMAGE_TYPES: ReadonlyArray<PawnItemPhotoImageType> = [
  'image/jpeg',
  'image/png',
  'image/webp',
]
const isImageType = (m: string): m is PawnItemPhotoImageType =>
  (IMAGE_TYPES as ReadonlyArray<string>).includes(m)

// The API takes 5 MB per image; the browser stores photos at a few hundred KB.
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
  const topSlug = String(formData.get('pawn_category') ?? '')
  const subSlug = String(formData.get('pawn_subcategory') ?? '') || null
  // Only this shop's own intake photos (the path's first folder is the shop).
  const paths = parseIntakePhotoPaths(formData.get('photo_paths'), gate.tenantId)
  if (!paths || paths.length === 0) return bad(400, 'bad_request')

  // The category the clerk picked must be one of this shop's.
  const categories = await loadPawnIntakeCategories(
    gate.ctx.supabase,
    gate.tenantId,
    gate.hasFirearms,
  )
  const top = categories.find((c) => c.slug === topSlug)
  if (!top) return bad(400, 'bad_request')
  const sub = subSlug ? top.subcategories.find((s) => s.slug === subSlug) ?? null : null

  // Read the photos from storage. A HEIC the browser could not convert
  // becomes JPEG here.
  const admin = createAdminClient()
  const images: Array<{ mime: PawnItemPhotoImageType; bytes: Buffer }> = []
  for (const path of paths) {
    const { data: blob, error } = await admin.storage.from(INVENTORY_PHOTOS_BUCKET).download(path)
    if (error || !blob) return bad(400, 'bad_request')
    if (blob.size > MAX_PHOTO_BYTES) return bad(413, 'photo_too_large')
    const declared = intakePhotoMime(path)
    const file = new File([blob], path.slice(path.lastIndexOf('/') + 1), { type: declared })
    const prepared = await prepareUpload(file, declared)
    if (!isImageType(prepared.mime)) return bad(415, 'photo_type')
    images.push({
      mime: prepared.mime,
      bytes:
        prepared.body instanceof File
          ? Buffer.from(await prepared.body.arrayBuffer())
          : prepared.body,
    })
  }

  const result = await describePawnItemPhoto({
    apiKey,
    categories,
    picked: {
      topSlug: top.slug,
      topLabel: top.label,
      subSlug: sub?.slug ?? null,
      subLabel: sub?.label ?? null,
    },
    images,
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
