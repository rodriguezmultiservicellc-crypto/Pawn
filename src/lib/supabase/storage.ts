/**
 * Storage helpers for the Pawn private buckets.
 *
 * Buckets are NEVER public. Customer ID scans, signatures, item photos —
 * all gated by RLS on storage.objects keyed off the first folder segment of
 * the path (which is always the tenant_id UUID).
 *
 * Path conventions (enforced by these helpers):
 *   customer-documents/<tenant_id>/<customer_id>/<kind>/<uuid>.<ext>
 *   inventory-photos/<tenant_id>/<item_id>/<uuid>.<ext>
 *
 * Upload flow:
 *   1. Server action receives a File (or Blob) from FormData.
 *   2. Action validates tenant access via requireStaff(tenantId).
 *   3. Action calls uploadCustomerDocument / uploadInventoryPhoto using
 *      the admin (service-role) client. Service role is required because
 *      Storage RLS still applies to authenticated clients but bucket-level
 *      writes from server actions are simpler with admin.
 *   4. Action inserts the matching DB row with the storage_path.
 *
 * Read flow:
 *   - getSignedUrl(bucket, path, ttlSeconds) — short-lived (default 3600s)
 *     URL that expires; never exposed in HTML at static-build time.
 */

import { createAdminClient } from './admin'

export const CUSTOMER_DOCUMENTS_BUCKET = 'customer-documents' as const
export const INVENTORY_PHOTOS_BUCKET = 'inventory-photos' as const
export const REPAIR_PHOTOS_BUCKET = 'repair-photos' as const
export const APPRAISAL_PHOTOS_BUCKET = 'appraisal-photos' as const
export const APPRAISAL_SIGNATURES_BUCKET = 'appraisal-signatures' as const

const DEFAULT_SIGNED_URL_TTL_SECONDS = 3600

/**
 * Pick a safe file extension from a MIME type or filename. Falls back to
 * 'bin' so we always have something. Lowercases for path consistency.
 */
function pickExtension(mimeType: string | null | undefined, filename?: string): string {
  if (filename) {
    const dot = filename.lastIndexOf('.')
    if (dot >= 0 && dot < filename.length - 1) {
      const ext = filename.slice(dot + 1).toLowerCase()
      if (/^[a-z0-9]{1,8}$/.test(ext)) return ext
    }
  }
  if (mimeType) {
    const map: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/heic': 'heic',
      'image/gif': 'gif',
      'application/pdf': 'pdf',
    }
    if (map[mimeType]) return map[mimeType]
  }
  return 'bin'
}

function newUuid(): string {
  // Web Crypto is available in the Next runtime on both Node and edge.
  return crypto.randomUUID()
}

/**
 * Build a storage path for a customer document. The first segment MUST be
 * the tenant UUID — RLS keys off it.
 */
export function customerDocumentPath(args: {
  tenantId: string
  customerId: string
  kind: 'id_scan' | 'signature'
  mimeType?: string | null
  filename?: string
}): string {
  const ext = pickExtension(args.mimeType, args.filename)
  return `${args.tenantId}/${args.customerId}/${args.kind}/${newUuid()}.${ext}`
}

/**
 * Build a storage path for a customer's portrait photo. Lives in the
 * customer-documents bucket (same RLS policy as ID scans / signatures)
 * but under a 'photo' folder for clarity. Stored on customers.photo_url
 * as a path (the column name is legacy — we always go through signed URLs).
 */
export function customerPhotoPath(args: {
  tenantId: string
  customerId: string
  mimeType?: string | null
  filename?: string
}): string {
  const ext = pickExtension(args.mimeType, args.filename)
  return `${args.tenantId}/${args.customerId}/photo/${newUuid()}.${ext}`
}

/**
 * Build a storage path for an inventory item photo.
 */
export function inventoryPhotoPath(args: {
  tenantId: string
  itemId: string
  mimeType?: string | null
  filename?: string
}): string {
  const ext = pickExtension(args.mimeType, args.filename)
  return `${args.tenantId}/${args.itemId}/${newUuid()}.${ext}`
}

/**
 * Build a storage path for a repair-ticket photo. tenant_id MUST be folder[0]
 * for RLS keying.
 */
export function repairPhotoPath(args: {
  tenantId: string
  ticketId: string
  kind: 'intake' | 'in_progress' | 'final' | 'reference'
  mimeType?: string | null
  filename?: string
}): string {
  const ext = pickExtension(args.mimeType, args.filename)
  return `${args.tenantId}/${args.ticketId}/${args.kind}/${newUuid()}.${ext}`
}

/**
 * Build a storage path for a repair-ticket pickup signature. Lives in the
 * repair-photos bucket under '<tenantId>/<ticketId>/pickup/signature_<uuid>.<ext>'.
 * Treated as regulated retention (FL = 2 years post-pickup).
 */
export function repairPickupSignaturePath(args: {
  tenantId: string
  ticketId: string
  mimeType?: string | null
  filename?: string
}): string {
  const ext = pickExtension(args.mimeType, args.filename)
  return `${args.tenantId}/${args.ticketId}/pickup/signature_${newUuid()}.${ext}`
}

/**
 * Build a storage path for an appraisal photo. tenant_id MUST be folder[0]
 * for RLS keying.
 */
export function appraisalPhotoPath(args: {
  tenantId: string
  appraisalId: string
  kind: 'front' | 'back' | 'detail' | 'serial' | 'cert' | 'reference'
  mimeType?: string | null
  filename?: string
}): string {
  const ext = pickExtension(args.mimeType, args.filename)
  return `${args.tenantId}/${args.appraisalId}/${args.kind}/${newUuid()}.${ext}`
}

/**
 * Build a storage path for an appraisal signature. role ∈ {appraiser, customer}.
 */
export function appraisalSignaturePath(args: {
  tenantId: string
  appraisalId: string
  role: 'appraiser' | 'customer'
  mimeType?: string | null
  filename?: string
}): string {
  const ext = pickExtension(args.mimeType, args.filename)
  return `${args.tenantId}/${args.appraisalId}/${args.role}/${newUuid()}.${ext}`
}

/**
 * Upload a file/blob to a private bucket. Uses the admin client so we
 * don't have to set up cookie-bound storage policies on the user-scoped
 * client every time. The path's tenant segment is enforced by callers.
 */
export async function uploadToBucket(args: {
  bucket:
    | typeof CUSTOMER_DOCUMENTS_BUCKET
    | typeof INVENTORY_PHOTOS_BUCKET
    | typeof REPAIR_PHOTOS_BUCKET
    | typeof APPRAISAL_PHOTOS_BUCKET
    | typeof APPRAISAL_SIGNATURES_BUCKET
  path: string
  body: Blob | ArrayBuffer | Uint8Array
  contentType?: string
}): Promise<{ path: string }> {
  const admin = createAdminClient()
  const { error } = await admin.storage
    .from(args.bucket)
    .upload(args.path, args.body, {
      contentType: args.contentType,
      upsert: false,
    })
  if (error) throw new Error(`storage upload failed: ${error.message}`)
  return { path: args.path }
}

/**
 * Generate a short-lived signed URL for a private bucket file. Always
 * gated upstream by a server action that re-checked tenant + role —
 * never call this on a path you didn't validate the caller has access to.
 */
export async function getSignedUrl(args: {
  bucket:
    | typeof CUSTOMER_DOCUMENTS_BUCKET
    | typeof INVENTORY_PHOTOS_BUCKET
    | typeof REPAIR_PHOTOS_BUCKET
    | typeof APPRAISAL_PHOTOS_BUCKET
    | typeof APPRAISAL_SIGNATURES_BUCKET
  path: string
  ttlSeconds?: number
}): Promise<string | null> {
  const admin = createAdminClient()
  const { data, error } = await admin.storage
    .from(args.bucket)
    .createSignedUrl(args.path, args.ttlSeconds ?? DEFAULT_SIGNED_URL_TTL_SECONDS)
  if (error || !data?.signedUrl) return null
  return data.signedUrl
}

/**
 * Best-effort delete. Used when removing a customer document or item photo.
 * If the storage delete fails, the DB row should still be soft-deleted —
 * a stale object in storage is recoverable; a stale DB row is the harder
 * inconsistency to debug.
 */
export async function deleteFromBucket(args: {
  bucket:
    | typeof CUSTOMER_DOCUMENTS_BUCKET
    | typeof INVENTORY_PHOTOS_BUCKET
    | typeof REPAIR_PHOTOS_BUCKET
    | typeof APPRAISAL_PHOTOS_BUCKET
    | typeof APPRAISAL_SIGNATURES_BUCKET
  path: string
}): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminClient()
  const { error } = await admin.storage.from(args.bucket).remove([args.path])
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
