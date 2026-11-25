import { resolveUploadMime } from './mime'

/**
 * BROWSER ONLY. Makes a picked photo fit for upload BEFORE it leaves the
 * browser: HEIC becomes JPEG, and a big photo is scaled down to JPEG.
 *
 * WHY (Eddy, 2026-11-25 — an iPhone HEIC in the New pawn ticket item popup):
 * 1. Chrome / Edge / Firefox cannot paint HEIC, so the preview was a broken
 *    image. Converting here gives a real preview everywhere.
 * 2. Every photo goes to a SERVER ACTION, and a server action takes a capped
 *    body (`serverActions.bodySizeLimit` in next.config.ts; Vercel's own cap is
 *    4.5 MB). A phone photo is 2-5 MB, so a ticket with one or two photos could
 *    not be saved at all. A 2000 px JPEG is a few hundred KB.
 *
 * The server still runs `prepareUpload` (lib/uploads/convert.ts) on what
 * arrives: if this step fails, the original goes up and the server converts
 * the HEIC as before.
 *
 * PDFs and anything that is not an image pass through untouched. A small
 * JPEG / PNG / WebP passes through too (a PNG signature keeps its
 * transparency).
 */

/** Longest side, in pixels, of a photo after fitting. Enough for an ID scan. */
export const PHOTO_MAX_EDGE = 2000
/** JPEG quality of a fitted photo. */
export const PHOTO_JPEG_QUALITY = 0.85
/** A browser-paintable image at or under this size is left alone. */
const SMALL_ENOUGH_BYTES = 700 * 1024

const PAINTABLE = new Set(['image/jpeg', 'image/png', 'image/webp'])

function jpegName(name: string): string {
  const base = (name || 'photo').replace(/\.[^./\\]*$/, '')
  return `${base || 'photo'}.jpg`
}

async function decode(file: File, mime: string): Promise<ImageBitmap> {
  if (mime === 'image/heic') {
    // Loaded only when a HEIC is picked: the decoder is large. The csp build
    // avoids eval.
    const { heicTo } = await import('heic-to/csp')
    return heicTo({ blob: file, type: 'bitmap' })
  }
  return createImageBitmap(file, { imageOrientation: 'from-image' })
}

function toJpeg(bitmap: ImageBitmap): Promise<Blob | null> {
  const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.resolve(null)
  // JPEG has no transparency: paint white under it, not black.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(bitmap, 0, 0, w, h)
  return new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', PHOTO_JPEG_QUALITY),
  )
}

/**
 * The file to upload in place of `file`. Never throws: on any failure the
 * original comes back.
 */
export async function fitPhotoForUpload(file: File): Promise<File> {
  const mime = resolveUploadMime(file)
  const heic = mime === 'image/heic'
  if (!heic && !PAINTABLE.has(mime)) return file
  if (!heic && file.size <= SMALL_ENOUGH_BYTES) return file

  try {
    const bitmap = await decode(file, mime)
    const blob = await toJpeg(bitmap)
    bitmap.close()
    if (!blob || blob.size === 0) return file
    // A paintable original that came out no smaller: keep the original.
    if (!heic && blob.size >= file.size) return file
    return new File([blob], jpegName(file.name), {
      type: 'image/jpeg',
      lastModified: file.lastModified,
    })
  } catch (err) {
    console.error('[uploads] could not fit photo in the browser; sending original', err)
    return file
  }
}

/**
 * Fits every file of a file <input> and puts the fitted files back INTO the
 * input, so a form that submits the input natively sends them. While it
 * works, the input is invalid (`busyMessage`), so the form cannot be
 * submitted with the original files half-way through.
 */
export async function fitInputFiles(
  input: HTMLInputElement,
  busyMessage: string,
): Promise<File[]> {
  const picked = input.files ? Array.from(input.files) : []
  if (picked.length === 0) return []
  input.setCustomValidity(busyMessage)
  try {
    const fitted = await Promise.all(picked.map(fitPhotoForUpload))
    if (fitted.some((f, i) => f !== picked[i])) {
      const dt = new DataTransfer()
      for (const f of fitted) dt.items.add(f)
      input.files = dt.files
    }
    return fitted
  } finally {
    input.setCustomValidity('')
  }
}
