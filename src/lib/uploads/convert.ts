import convert from 'heic-convert'
import { resolveUploadMime } from './mime'

/**
 * SERVER ONLY. Normalises an uploaded image into something a browser can
 * actually display, before it is written to storage.
 *
 * WHY: iPhones shoot HEIC by default. Chrome, Edge and Firefox refuse to paint
 * HEIC, so a stored .heic ID scan is a file staff can download but never SEE —
 * which defeats the point of putting the ID in the customer header. Converting
 * once at upload time means every downstream reader (the header tile, the
 * documents list, the ticket PDFs, the customer portal) gets a plain JPEG and
 * none of them need to care that the phone produced HEIC.
 *
 * Converting on the way IN rather than on the way out is deliberate: it happens
 * once per file instead of on every view, and it keeps the stored bytes and the
 * recorded mime_type honest about each other.
 *
 * DO NOT import this from a client component — heic-convert is a Node module
 * and will not bundle. `isBrowserRenderableImage` lives in ./mime.ts precisely
 * so the client can ask that question without dragging the decoder in.
 */

/** Above this, decoding is refused rather than risking the function's memory. */
const MAX_CONVERT_BYTES = 20 * 1024 * 1024

export type PreparedUpload = {
  /** What to hand to uploadToBucket. */
  body: File | Buffer
  /** The true type of `body` — use for Content-Type AND the DB mime_type. */
  mime: string
  /** Filename with an extension matching `body`, for extension pickers. */
  filename: string
  /** Byte length of `body` — record THIS, not file.size, which is the input. */
  size: number
  /** True when the bytes were transcoded. */
  converted: boolean
}

function swapExtension(filename: string, ext: string): string {
  const base = filename.replace(/\.[^./\\]*$/, '')
  return `${base || 'upload'}.${ext}`
}

/**
 * Convert HEIC to JPEG; pass everything else through untouched.
 *
 * `declaredMime` should be the already-resolved type from resolveUploadMime —
 * callers validate that against their allowlist BEFORE calling here, so a
 * rejected file is never decoded.
 *
 * On any conversion failure the ORIGINAL file is returned rather than throwing.
 * Losing a pawn's ID scan because a decoder tripped would be worse than storing
 * a file the browser cannot inline: the record still exists, the download link
 * still works, and the caller's mime_type stays truthful about the bytes.
 */
export async function prepareUpload(
  file: File,
  declaredMime?: string,
): Promise<PreparedUpload> {
  const mime = declaredMime ?? resolveUploadMime(file)
  const passthrough: PreparedUpload = {
    body: file,
    mime,
    filename: file.name,
    size: file.size,
    converted: false,
  }

  if (mime !== 'image/heic') return passthrough
  if (file.size > MAX_CONVERT_BYTES) {
    console.warn(
      `[uploads] HEIC too large to convert (${file.size} bytes); storing original`,
    )
    return passthrough
  }

  try {
    const input = Buffer.from(await file.arrayBuffer())
    const output = await convert({
      buffer: input,
      format: 'JPEG',
      // High enough that an ID stays legible; low enough to stay near the
      // size of the HEIC it replaces.
      quality: 0.85,
    })
    const jpeg = Buffer.from(output)
    if (jpeg.length === 0) return passthrough

    return {
      body: jpeg,
      mime: 'image/jpeg',
      filename: swapExtension(file.name || 'upload', 'jpg'),
      size: jpeg.length,
      converted: true,
    }
  } catch (err) {
    console.error('[uploads] HEIC conversion failed; storing original', err)
    return passthrough
  }
}
