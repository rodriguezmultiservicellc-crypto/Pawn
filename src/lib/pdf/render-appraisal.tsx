/**
 * Server-side renderer for the bilingual appraisal certificate PDF.
 *
 * Pure function: takes an appraisalId + tenantId + the user-scoped Supabase
 * client (so RLS + tenant scoping apply at the DB layer) and returns a Buffer
 * that the route handler streams back to the browser.
 *
 * Data resolution policy:
 *   - Appraisal, customer, stones, photos (rows), tenant, appraiser profile:
 *     user-scoped client. RLS enforces tenant isolation. The route handler
 *     ALSO calls requireRoleInTenant() before invoking us — defense in depth.
 *   - Photo image bytes + signatures: fetched as raw bytes via a signed URL
 *     (admin client). The path was already validated as belonging to this
 *     appraisal's tenant in step (1).
 */

import { renderToBuffer } from '@react-pdf/renderer'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { en } from '@/lib/i18n/en'
import { es } from '@/lib/i18n/es'
import {
  APPRAISAL_PHOTOS_BUCKET,
  APPRAISAL_SIGNATURES_BUCKET,
  getSignedUrl,
} from '@/lib/supabase/storage'
import { todayDateString, toMoney } from '@/lib/pawn/math'
import { asLoose } from '@/lib/appraisals/db'
import { registerPdfFonts } from './fonts'
import AppraisalPDF, {
  type AppraisalCustomer,
  type AppraisalPdfData,
  type AppraisalPhotoView,
  type AppraisalStoneRowView,
  type AppraisalTenant,
} from './AppraisalPDF'
import type {
  AppraisalPhotoKind,
  AppraisalPurpose,
  AppraisalStatus,
  MetalType,
} from '@/types/database-aliases'

export type RenderAppraisalResult = {
  buffer: Buffer
  appraisalNumber: string
}

export async function renderAppraisalPdf(args: {
  supabase: SupabaseClient<Database>
  appraisalId: string
  tenantId: string
}): Promise<RenderAppraisalResult> {
  const { supabase, appraisalId, tenantId } = args

  // ── 1. Appraisal + customer
  const { data: appraisal, error: aErr } = await asLoose(supabase)
    .from('appraisals')
    .select(
      `id, tenant_id, appraisal_number, customer_id, inventory_item_id,
       item_description, metal_type, karat, weight_grams, purpose,
       appraised_value, replacement_value, valuation_method, notes,
       appraiser_user_id, appraiser_signature_storage_path,
       customer_signature_storage_path,
       valid_from, valid_until, status, is_printed,
       customer:customers(
         id, first_name, last_name, middle_name, phone, email,
         address1, address2, city, state, zip
       )`,
    )
    .eq('id', appraisalId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle()

  if (aErr) throw new Error(`appraisal_lookup_failed: ${aErr.message}`)
  if (!appraisal) throw new Error('appraisal_not_found')

  // ── 2. Tenant
  const { data: tenant, error: tErr } = await supabase
    .from('tenants')
    .select('id, name, dba, address, city, state, zip, phone, email')
    .eq('id', tenantId)
    .maybeSingle()
  if (tErr) throw new Error(`tenant_lookup_failed: ${tErr.message}`)
  if (!tenant) throw new Error('tenant_not_found')

  // ── 3. Stones
  const { data: stoneRows } = await asLoose(supabase)
    .from('appraisal_stones')
    .select(
      'position, count, type, cut, est_carat, color, clarity, certified, cert_lab, cert_number',
    )
    .eq('appraisal_id', appraisalId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('position', { ascending: true })

  const stones: AppraisalStoneRowView[] = (stoneRows ?? []).map((s) => ({
    position: s.position,
    count: s.count,
    type: s.type,
    cut: s.cut,
    est_carat: s.est_carat == null ? null : Number(s.est_carat),
    color: s.color,
    clarity: s.clarity,
    certified: !!s.certified,
    cert_lab: s.cert_lab,
    cert_number: s.cert_number,
  }))

  // ── 4. Photos (data URLs, capped at 4 for the print)
  const { data: photoRows } = await asLoose(supabase)
    .from('appraisal_photos')
    .select('id, storage_path, kind, caption, position')
    .eq('appraisal_id', appraisalId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('position', { ascending: true })
    .limit(4)

  const photos: AppraisalPhotoView[] = await Promise.all(
    (photoRows ?? []).map(async (p) => ({
      kind: p.kind as AppraisalPhotoKind,
      data_url: await fetchAsDataUrl(APPRAISAL_PHOTOS_BUCKET, p.storage_path),
      caption: p.caption,
    })),
  )

  // ── 5. Appraiser profile
  let appraiserName: string | null = null
  let appraiserEmail: string | null = null
  if (appraisal.appraiser_user_id) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, email')
      .eq('id', appraisal.appraiser_user_id)
      .maybeSingle()
    appraiserName = profile?.full_name ?? null
    appraiserEmail = profile?.email ?? null
  }

  const appraiserSignature = appraisal.appraiser_signature_storage_path
    ? await fetchAsDataUrl(
        APPRAISAL_SIGNATURES_BUCKET,
        appraisal.appraiser_signature_storage_path,
      )
    : null

  const customerSignature = appraisal.customer_signature_storage_path
    ? await fetchAsDataUrl(
        APPRAISAL_SIGNATURES_BUCKET,
        appraisal.customer_signature_storage_path,
      )
    : null

  // ── 6. Build customer view
  const c = (
    appraisal as unknown as {
      customer: {
        first_name: string
        last_name: string
        middle_name: string | null
        phone: string | null
        email: string | null
        address1: string | null
        address2: string | null
        city: string | null
        state: string | null
        zip: string | null
      } | null
    }
  ).customer

  const customerView: AppraisalCustomer | null = c
    ? {
        full_name: [c.first_name, c.middle_name, c.last_name]
          .filter((s): s is string => Boolean(s && s.trim()))
          .join(' '),
        phone: c.phone,
        email: c.email,
        address1: c.address1,
        address2: c.address2,
        city: c.city,
        state: c.state,
        zip: c.zip,
      }
    : null

  const tenantView: AppraisalTenant = {
    name: tenant.name,
    dba: tenant.dba,
    address: tenant.address,
    city: tenant.city,
    state: tenant.state,
    zip: tenant.zip,
    phone: tenant.phone,
    email: tenant.email,
  }

  // ── 7. Assemble + render
  const data: AppraisalPdfData = {
    appraisal_number: appraisal.appraisal_number ?? '',
    status: appraisal.status as AppraisalStatus,
    purpose: appraisal.purpose as AppraisalPurpose,
    is_printed: appraisal.is_printed,
    item_description: appraisal.item_description,
    metal_type: (appraisal.metal_type as MetalType | null) ?? null,
    karat: appraisal.karat == null ? null : Number(appraisal.karat),
    weight_grams:
      appraisal.weight_grams == null ? null : Number(appraisal.weight_grams),
    appraised_value: toMoney(appraisal.appraised_value),
    replacement_value:
      appraisal.replacement_value == null
        ? null
        : toMoney(appraisal.replacement_value),
    valuation_method: appraisal.valuation_method,
    notes: appraisal.notes,
    valid_from: appraisal.valid_from,
    valid_until: appraisal.valid_until,
    customer: customerView,
    tenant: tenantView,
    appraiser: {
      full_name: appraiserName,
      email: appraiserEmail,
      signature_image: appraiserSignature,
    },
    stones,
    photos,
    customer_signature_image: customerSignature,
    i18n: { en, es },
    printed_on: todayDateString(),
  }

  registerPdfFonts()
  const buffer = await renderToBuffer(<AppraisalPDF data={data} />)
  return { buffer, appraisalNumber: data.appraisal_number }
}

/**
 * Fetch a Storage object as a data URL so React-PDF can embed it without
 * making its own network call. Uses a 60-second signed URL. Returns null on
 * any failure — the renderer treats a missing image as "not on file".
 */
async function fetchAsDataUrl(
  bucket: typeof APPRAISAL_PHOTOS_BUCKET | typeof APPRAISAL_SIGNATURES_BUCKET,
  storagePath: string,
): Promise<string | null> {
  try {
    const url = await getSignedUrl({
      bucket,
      path: storagePath,
      ttlSeconds: 60,
    })
    if (!url) return null
    const res = await fetch(url)
    if (!res.ok) return null
    const contentType =
      res.headers.get('content-type') ?? guessMimeFromPath(storagePath)
    const arrayBuffer = await res.arrayBuffer()
    const base64 = Buffer.from(arrayBuffer).toString('base64')
    return `data:${contentType};base64,${base64}`
  } catch (err) {
    console.error('[pdf.appraisal] fetch failed', err)
    return null
  }
}

function guessMimeFromPath(p: string): string {
  const ext = p.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'webp':
      return 'image/webp'
    case 'heic':
      return 'image/heic'
    default:
      return 'application/octet-stream'
  }
}
