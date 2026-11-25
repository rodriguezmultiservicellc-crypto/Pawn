import 'server-only'
import { INVENTORY_PHOTOS_BUCKET, getSignedUrls } from '@/lib/supabase/storage'
import { parseIntakePhotoPaths } from './intake-photos'

/**
 * SERVER ONLY. An item's photo list as a form sent it → the paths to record,
 * once each one is checked to be this tenant's (parseIntakePhotoPaths) and
 * to really be in storage. A list that fails either check is refused whole:
 * a ticket must not be written with a photo the clerk saw on screen and the
 * shop does not have.
 */
export async function confirmIntakePhotos(
  raw: unknown,
  tenantId: string,
): Promise<{ ok: true; paths: string[] } | { ok: false }> {
  const paths = parseIntakePhotoPaths(raw, tenantId)
  if (paths == null) return { ok: false }
  if (paths.length === 0) return { ok: true, paths }
  // A path that is not in storage gets no signed URL.
  const found = await getSignedUrls({ bucket: INVENTORY_PHOTOS_BUCKET, paths, ttlSeconds: 60 })
  return paths.every((p) => found.has(p)) ? { ok: true, paths } : { ok: false }
}

/** Signed URLs (1 h) for photos to show again — a resumed draft. Paths that
 *  are not this tenant's, or not in storage, are left out. */
export async function signIntakePhotos(
  raw: unknown,
  tenantId: string,
): Promise<Array<{ path: string; url: string }>> {
  const paths = parseIntakePhotoPaths(raw, tenantId) ?? []
  const urls = await getSignedUrls({ bucket: INVENTORY_PHOTOS_BUCKET, paths })
  return paths.flatMap((path) => {
    const url = urls.get(path)
    return url ? [{ path, url }] : []
  })
}
