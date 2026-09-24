/**
 * Resolve the MIME type of an uploaded file WITHOUT trusting the browser.
 *
 * WHY THIS EXISTS: every upload action used to validate with
 * `ALLOWED_*_MIME_TYPES.includes(file.type)`. `file.type` comes from the
 * operating system's type registry, not from the file, and for HEIC on Windows
 * that registry is usually empty — Chrome hands us `file.type === ''` for a
 * perfectly valid `IMG_1234.HEIC` straight off an iPhone. The strict check then
 * rejected it with `mime_not_allowed` even though 'image/heic' was in the
 * allowlist the whole time. Same story for 'image/heif', which some sources
 * report instead.
 *
 * So: believe `file.type` when it says something we recognise, otherwise fall
 * back to the filename extension, and normalise the aliases. The result is used
 * for the allowlist check AND for the stored Content-Type, so a file uploaded
 * with a blank type no longer lands in the bucket labelled ''.
 *
 * This is a usability fix, not a security control. It is an ALLOWLIST gate —
 * callers still reject anything not on their list — but neither the extension
 * nor the browser-declared type proves file contents. Storage buckets stay
 * private and served through signed URLs (CLAUDE.md rule 12), which is what
 * actually contains a mislabelled upload.
 */

const EXTENSION_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heic',
  pdf: 'application/pdf',
}

/** Storage-path extension for a known type. Superset of every former copy. */
const MIME_TO_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
}

/** Aliases browsers and phones report for the same format. */
const MIME_ALIASES: Record<string, string> = {
  'image/jpg': 'image/jpeg',
  'image/heif': 'image/heic',
  'image/heic-sequence': 'image/heic',
  'image/heif-sequence': 'image/heic',
}

/** Formats no mainstream browser can render in an <img>. */
const BROWSER_UNRENDERABLE = new Set(['image/heic'])

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase()
}

/**
 * Best-effort MIME for an uploaded file. Prefers a recognised `file.type`,
 * falls back to the extension, and returns '' when neither is usable (callers
 * reject that against their allowlist).
 */
export function resolveUploadMime(file: File): string {
  const declared = (file.type || '').trim().toLowerCase()
  const normalised = MIME_ALIASES[declared] ?? declared

  // A declared type we recognise wins.
  if (normalised && Object.values(EXTENSION_TO_MIME).includes(normalised)) {
    return normalised
  }

  // Otherwise trust the extension — this is the HEIC-on-Windows path.
  const fromExtension = EXTENSION_TO_MIME[extensionOf(file.name || '')]
  if (fromExtension) return fromExtension

  // Unknown on both counts: hand back whatever was declared so the caller's
  // allowlist rejects it and the error stays truthful.
  return normalised
}

/**
 * Extension to give a stored object, preferring the one the user's filename
 * already carries and falling back to the type.
 *
 * This replaced seven near-identical private `pickExt` / `pickExtension` copies
 * (six upload actions plus lib/supabase/storage.ts) that differed only in which
 * types their fallback covered — appraisals omitted pdf, only storage.ts knew
 * gif. The map here is the superset, so the only behaviour change is that a
 * file with NO usable extension and a pdf/gif type now gets 'pdf'/'gif'
 * instead of 'bin'.
 */
export function extensionForUpload(
  mime: string | null | undefined,
  filename?: string,
): string {
  if (filename) {
    const dot = filename.lastIndexOf('.')
    if (dot >= 0 && dot < filename.length - 1) {
      const ext = filename.slice(dot + 1).toLowerCase()
      if (/^[a-z0-9]{1,8}$/.test(ext)) return ext
    }
  }
  if (mime) {
    const normalised = MIME_ALIASES[mime.toLowerCase()] ?? mime.toLowerCase()
    if (MIME_TO_EXTENSION[normalised]) return MIME_TO_EXTENSION[normalised]
  }
  return 'bin'
}

/**
 * True when a browser cannot paint this type in an <img>. HEIC is the live
 * case: Safari renders it, Chrome / Edge / Firefox do not, so a staff machine
 * would show a broken image. Callers should render a link/download tile
 * instead.
 */
export function isBrowserRenderableImage(mime: string | null): boolean {
  const m = (mime ?? '').trim().toLowerCase()
  if (!m.startsWith('image/')) return false
  return !BROWSER_UNRENDERABLE.has(MIME_ALIASES[m] ?? m)
}
