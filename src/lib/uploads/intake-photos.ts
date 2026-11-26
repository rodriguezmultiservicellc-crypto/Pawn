/**
 * Photos of an item taken at intake — a pawn ticket's collateral or a buy
 * (Eddy, 2026-11-25: "I'm bound to only 1 photo, I want to put more").
 *
 * The browser uploads each photo STRAIGHT to the private inventory-photos
 * bucket the moment it is picked (components/uploads/PhotoStrip), into the
 * shop's own folder — the bucket's storage policy lets staff write there and
 * nowhere else. The form then carries only the photos' paths, as one JSON
 * list per item, so a ticket with many photos never runs into the size cap
 * of a server action. The server takes a list only through
 * parseIntakePhotoPaths, and checks the files exist before recording them.
 *
 * Path: <tenant_id>/intake/<uuid>.<ext> — the first folder is the tenant,
 * which is what the storage policy keys off.
 *
 * Pure: the browser, the server actions and the tests share it.
 */

/** The buckets intake photos go to (= INVENTORY_PHOTOS_BUCKET /
 *  REPAIR_PHOTOS_BUCKET in lib/supabase/storage, which the browser cannot
 *  import): pawn collateral and buys in inventory-photos, repair items in
 *  repair-photos (patches/0119). Both buckets' storage policies let staff
 *  write in their own shop's folder. */
export type IntakePhotoBucket = 'inventory-photos' | 'repair-photos'

/** Most photos one item may have. */
export const INTAKE_PHOTO_MAX = 6

/** What a stored intake photo may be. */
export const INTAKE_PHOTO_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'heic'] as const

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

function pathPattern(tenantId: string): RegExp {
  return new RegExp(`^${tenantId}/intake/${UUID}\\.(${INTAKE_PHOTO_EXTENSIONS.join('|')})$`)
}

/** Where a new intake photo is stored. */
export function intakePhotoPath(tenantId: string, ext: string): string {
  const e = (INTAKE_PHOTO_EXTENSIONS as ReadonlyArray<string>).includes(ext) ? ext : 'jpg'
  return `${tenantId}/intake/${crypto.randomUUID()}.${e}`
}

/**
 * An item's photo list as the form sent it (a JSON array of paths) → the
 * paths, in order, the first being the main photo. Only paths in THIS
 * tenant's intake folder are taken; repeats are dropped; at most
 * INTAKE_PHOTO_MAX. Returns null when the value is not a list of strings at
 * all, or holds a path that is not this tenant's — the caller refuses the
 * submission rather than drop a photo silently.
 */
export function parseIntakePhotoPaths(
  raw: unknown,
  tenantId: string,
): string[] | null {
  if (raw == null || raw === '') return []
  let list: unknown = raw
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (!Array.isArray(list)) return null
  const pattern = pathPattern(tenantId)
  const out: string[] = []
  for (const p of list) {
    if (typeof p !== 'string' || !pattern.test(p)) return null
    if (!out.includes(p)) out.push(p)
  }
  return out.length > INTAKE_PHOTO_MAX ? null : out
}

/** The paths of a stored item: its main photo, then the rest. */
export function allPhotoPaths(item: {
  photo_path: string | null
  extra_photo_paths?: ReadonlyArray<string> | null
}): string[] {
  return [item.photo_path, ...(item.extra_photo_paths ?? [])].filter(
    (p): p is string => typeof p === 'string' && p !== '',
  )
}

/** The content type of a stored intake photo, from its extension. */
export function intakePhotoMime(path: string): 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic' {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'heic') return 'image/heic'
  return 'image/jpeg'
}
