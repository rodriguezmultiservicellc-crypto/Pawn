import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import {
  APPRAISAL_PHOTOS_BUCKET,
  getSignedUrl,
} from '@/lib/supabase/storage'
import AppraisalDetail, {
  type AppraisalDetailView,
  type AppraisalPhotoDetailView,
  type AppraisalStoneDetailView,
} from './content'
import type {
  AppraisalPhotoKind,
  AppraisalPurpose,
  AppraisalStatus,
  MetalType,
} from '@/types/database-aliases'

type Params = Promise<{ id: string }>

export default async function AppraisalDetailPage(props: { params: Params }) {
  const { id } = await props.params
  const ctx = await getCtx()
  if (!ctx) redirect('/login')

  const { data: appraisal } = await ctx.supabase
    .from('appraisals')
    .select(
      `id, tenant_id, appraisal_number, customer_id, inventory_item_id,
       item_description, metal_type, karat, weight_grams, purpose,
       appraised_value, replacement_value, valuation_method, comparable_data,
       notes, appraiser_user_id, valid_from, valid_until,
       status, finalized_at, finalized_by, voided_at, voided_by, void_reason,
       is_printed, printed_at, created_at, updated_at,
       customer:customers(id, first_name, last_name, phone, email),
       inventory_item:inventory_items(id, sku, description)`,
    )
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (!appraisal) redirect('/appraisals')

  const [{ data: stones }, { data: photos }] = await Promise.all([
    ctx.supabase
      .from('appraisal_stones')
      .select(
        'id, position, count, type, cut, est_carat, color, clarity, certified, cert_lab, cert_number, notes',
      )
      .eq('appraisal_id', id)
      .is('deleted_at', null)
      .order('position', { ascending: true }),
    ctx.supabase
      .from('appraisal_photos')
      .select('id, storage_path, kind, caption, position, created_at')
      .eq('appraisal_id', id)
      .is('deleted_at', null)
      .order('position', { ascending: true }),
  ])

  // Resolve appraiser name.
  let appraiserName: string | null = null
  let appraiserEmail: string | null = null
  if (appraisal.appraiser_user_id) {
    const { data: profile } = await ctx.supabase
      .from('profiles')
      .select('full_name, email')
      .eq('id', appraisal.appraiser_user_id)
      .maybeSingle()
    appraiserName = profile?.full_name?.trim() || null
    appraiserEmail = profile?.email ?? null
  }

  // Sign photo URLs in parallel (1h TTL).
  const photoViews: AppraisalPhotoDetailView[] = await Promise.all(
    (photos ?? []).map(async (p) => ({
      id: p.id,
      storage_path: p.storage_path,
      kind: p.kind as AppraisalPhotoKind,
      caption: p.caption,
      position: p.position,
      signed_url: await getSignedUrl({
        bucket: APPRAISAL_PHOTOS_BUCKET,
        path: p.storage_path,
        ttlSeconds: 3600,
      }),
    })),
  )

  const c = (
    appraisal as unknown as {
      customer: {
        id: string
        first_name: string
        last_name: string
        phone: string | null
        email: string | null
      } | null
    }
  ).customer

  const inv = (
    appraisal as unknown as {
      inventory_item: {
        id: string
        sku: string
        description: string
      } | null
    }
  ).inventory_item

  const view: AppraisalDetailView = {
    id: appraisal.id,
    tenant_id: appraisal.tenant_id,
    appraisal_number: appraisal.appraisal_number ?? '',
    customer_id: appraisal.customer_id,
    customer_name: c ? `${c.last_name}, ${c.first_name}` : null,
    customer_phone: c?.phone ?? null,
    customer_email: c?.email ?? null,
    inventory_item_id: appraisal.inventory_item_id,
    inventory_item_label: inv ? `${inv.sku} — ${inv.description}` : null,
    item_description: appraisal.item_description,
    metal_type: (appraisal.metal_type as MetalType | null) ?? null,
    karat: appraisal.karat == null ? null : Number(appraisal.karat),
    weight_grams:
      appraisal.weight_grams == null ? null : Number(appraisal.weight_grams),
    purpose: appraisal.purpose as AppraisalPurpose,
    appraised_value: Number(appraisal.appraised_value ?? 0),
    replacement_value:
      appraisal.replacement_value == null
        ? null
        : Number(appraisal.replacement_value),
    valuation_method: appraisal.valuation_method,
    notes: appraisal.notes,
    appraiser_user_id: appraisal.appraiser_user_id,
    appraiser_name: appraiserName,
    appraiser_email: appraiserEmail,
    valid_from: appraisal.valid_from,
    valid_until: appraisal.valid_until,
    status: appraisal.status as AppraisalStatus,
    finalized_at: appraisal.finalized_at,
    voided_at: appraisal.voided_at,
    void_reason: appraisal.void_reason,
    is_printed: appraisal.is_printed,
    printed_at: appraisal.printed_at,
    created_at: appraisal.created_at,
  }

  const stoneViews: AppraisalStoneDetailView[] = (stones ?? []).map((s) => ({
    id: s.id,
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
    notes: s.notes,
  }))

  return (
    <AppraisalDetail
      appraisal={view}
      stones={stoneViews}
      photos={photoViews}
    />
  )
}
