'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/supabase/ctx'
import { requireStaff } from '@/lib/supabase/guards'
import {
  inventoryItemUpdateSchema,
  inventoryStoneSchema,
  ALLOWED_PHOTO_MIME_TYPES,
  MAX_PHOTO_BYTES,
} from '@/lib/validations/inventory'
import {
  INVENTORY_PHOTOS_BUCKET,
  deleteFromBucket,
  inventoryPhotoPath,
  uploadToBucket,
} from '@/lib/supabase/storage'
import { logAudit } from '@/lib/audit'

export type UpdateInventoryItemState = {
  error?: string
  fieldErrors?: Record<string, string>
  ok?: boolean
}

async function resolveItemTenant(itemId: string) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')

  const { data: item } = await ctx.supabase
    .from('inventory_items')
    .select('tenant_id')
    .eq('id', itemId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!item) redirect('/inventory')

  const { supabase, userId } = await requireStaff(item.tenant_id)
  return { tenantId: item.tenant_id, supabase, userId }
}

export async function updateInventoryItemAction(
  _prev: UpdateInventoryItemState,
  formData: FormData,
): Promise<UpdateInventoryItemState> {
  const id = (formData.get('id') as string | null)?.trim()
  if (!id) return { error: 'missing id' }

  const { tenantId, supabase, userId } = await resolveItemTenant(id)

  const raw: Record<string, FormDataEntryValue | null> = { id }
  for (const key of [
    'sku',
    'description',
    'category',
    'brand',
    'model',
    'serial_number',
    'metal',
    'karat',
    'weight_grams',
    'weight_dwt',
    'cost_basis',
    'list_price',
    'sale_price',
    'source',
    'source_vendor',
    'acquired_at',
    'acquired_cost',
    'hold_until',
    'location',
    'status',
    'notes',
    'staff_memo',
    'tags',
  ]) {
    raw[key] = formData.get(key)
  }

  const parsed = inventoryItemUpdateSchema.safeParse(raw)
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.')
      if (path) fieldErrors[path] = issue.message
    }
    return { fieldErrors }
  }

  const v = parsed.data

  // Block in-place edits while an item is actively part of a transfer.
  // The transfer accept/reject/cancel flow is the only legitimate way to
  // change ownership/status while status='transferred'. This guard is
  // defense-in-depth — the UI also disables editing.
  const { data: lockCheck } = await supabase
    .from('inventory_items')
    .select('status')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle()
  if (lockCheck?.status === 'transferred') {
    return { error: 'item_locked_in_transfer' }
  }

  const { error } = await supabase
    .from('inventory_items')
    .update({
      // sku is read-only on edit (already set by trigger or explicit on create)
      description: v.description,
      category: v.category,
      brand: v.brand,
      model: v.model,
      serial_number: v.serial_number,
      metal: v.metal ?? null,
      karat: v.karat,
      weight_grams: v.weight_grams,
      weight_dwt: v.weight_dwt,
      cost_basis: v.cost_basis,
      list_price: v.list_price,
      sale_price: v.sale_price,
      source: v.source,
      source_vendor: v.source_vendor,
      acquired_at: v.acquired_at,
      acquired_cost: v.acquired_cost,
      hold_until: v.hold_until,
      location: v.location,
      status: v.status,
      // If status flipped to sold and no sold_at yet, stamp it.
      sold_at:
        v.status === 'sold'
          ? (formData.get('__current_sold_at') as string | null) ||
            new Date().toISOString()
          : null,
      notes: v.notes,
      staff_memo: v.staff_memo,
      tags: v.tags,
      updated_by: userId,
    })
    .eq('id', id)
    .eq('tenant_id', tenantId)

  if (error) return { error: error.message }

  await logAudit({
    tenantId,
    userId,
    action: 'update',
    tableName: 'inventory_items',
    recordId: id,
    changes: {
      description: v.description,
      status: v.status,
      location: v.location,
      list_price: v.list_price,
      sale_price: v.sale_price,
    },
  })

  revalidatePath(`/inventory/${id}`)
  revalidatePath('/inventory')
  return { ok: true }
}

export async function deleteInventoryItemAction(
  formData: FormData,
): Promise<void> {
  const id = (formData.get('id') as string | null)?.trim()
  if (!id) return

  const { tenantId, supabase, userId } = await resolveItemTenant(id)

  // Block delete on sold items — sale references will land in Phase 4.
  // Also block deletes on items currently part of an open transfer.
  const { data: item } = await supabase
    .from('inventory_items')
    .select('status')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle()

  if (item?.status === 'sold' || item?.status === 'transferred') return

  await supabase
    .from('inventory_items')
    .update({ deleted_at: new Date().toISOString(), updated_by: userId })
    .eq('id', id)
    .eq('tenant_id', tenantId)

  await logAudit({
    tenantId,
    userId,
    action: 'soft_delete',
    tableName: 'inventory_items',
    recordId: id,
  })

  revalidatePath('/inventory')
  redirect('/inventory')
}

// ── Photos ──────────────────────────────────────────────────────────────

export async function uploadInventoryPhotoAction(
  formData: FormData,
): Promise<{ error?: string }> {
  const itemId = (formData.get('item_id') as string | null)?.trim()
  if (!itemId) return { error: 'missing item_id' }

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) return { error: 'no_file' }
  if (file.size > MAX_PHOTO_BYTES) return { error: 'too_large' }
  if (!ALLOWED_PHOTO_MIME_TYPES.includes(file.type as never)) {
    return { error: 'mime_not_allowed' }
  }

  const { tenantId, supabase, userId } = await resolveItemTenant(itemId)

  // Determine next position. RLS gates the read.
  const { data: existing } = await supabase
    .from('inventory_item_photos')
    .select('position, is_primary')
    .eq('item_id', itemId)
    .is('deleted_at', null)
    .order('position', { ascending: false })
    .limit(1)

  const nextPosition = (existing?.[0]?.position ?? -1) + 1
  const isFirst = !existing || existing.length === 0

  const path = inventoryPhotoPath({
    tenantId,
    itemId,
    mimeType: file.type,
    filename: file.name,
  })

  await uploadToBucket({
    bucket: INVENTORY_PHOTOS_BUCKET,
    path,
    body: file,
    contentType: file.type,
  })

  const { data: photoRow, error } = await supabase
    .from('inventory_item_photos')
    .insert({
      tenant_id: tenantId,
      item_id: itemId,
      storage_path: path,
      mime_type: file.type,
      byte_size: file.size,
      position: nextPosition,
      is_primary: isFirst, // first uploaded photo becomes primary by default
      created_by: userId,
    })
    .select('id')
    .single()

  if (error) {
    await deleteFromBucket({ bucket: INVENTORY_PHOTOS_BUCKET, path }).catch(
      () => {},
    )
    return { error: error.message }
  }

  if (photoRow?.id) {
    await logAudit({
      tenantId,
      userId,
      action: 'photo_upload',
      tableName: 'inventory_item_photos',
      recordId: photoRow.id,
      changes: { item_id: itemId, mime_type: file.type, position: nextPosition },
    })
  }

  revalidatePath(`/inventory/${itemId}`)
  return {}
}

export async function makePhotoPrimaryAction(
  formData: FormData,
): Promise<void> {
  const photoId = (formData.get('photo_id') as string | null)?.trim()
  const itemId = (formData.get('item_id') as string | null)?.trim()
  if (!photoId || !itemId) return

  const { tenantId, supabase, userId } = await resolveItemTenant(itemId)

  // The BEFORE TRIGGER on inventory_item_photos.is_primary demotes other
  // primaries; we just set this one TRUE.
  await supabase
    .from('inventory_item_photos')
    .update({ is_primary: true })
    .eq('id', photoId)
    .eq('item_id', itemId)
    .eq('tenant_id', tenantId)

  await logAudit({
    tenantId,
    userId,
    action: 'photo_set_primary',
    tableName: 'inventory_item_photos',
    recordId: photoId,
    changes: { item_id: itemId },
  })

  revalidatePath(`/inventory/${itemId}`)
}

export async function deleteInventoryPhotoAction(
  formData: FormData,
): Promise<void> {
  const photoId = (formData.get('photo_id') as string | null)?.trim()
  const itemId = (formData.get('item_id') as string | null)?.trim()
  if (!photoId || !itemId) return

  const { tenantId, supabase, userId } = await resolveItemTenant(itemId)

  const { data: photo } = await supabase
    .from('inventory_item_photos')
    .select('storage_path, is_primary')
    .eq('id', photoId)
    .eq('item_id', itemId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!photo) return

  await supabase
    .from('inventory_item_photos')
    .update({ deleted_at: new Date().toISOString(), is_primary: false })
    .eq('id', photoId)
    .eq('tenant_id', tenantId)

  await deleteFromBucket({
    bucket: INVENTORY_PHOTOS_BUCKET,
    path: photo.storage_path,
  }).catch(() => {})

  // If we just deleted the primary, promote the next-positioned photo.
  if (photo.is_primary) {
    const { data: next } = await supabase
      .from('inventory_item_photos')
      .select('id')
      .eq('item_id', itemId)
      .is('deleted_at', null)
      .order('position', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (next?.id) {
      await supabase
        .from('inventory_item_photos')
        .update({ is_primary: true })
        .eq('id', next.id)
    }
  }

  await logAudit({
    tenantId,
    userId,
    action: 'photo_delete',
    tableName: 'inventory_item_photos',
    recordId: photoId,
    changes: { item_id: itemId },
  })

  revalidatePath(`/inventory/${itemId}`)
}

// ── Stones ──────────────────────────────────────────────────────────────

export async function addInventoryStoneAction(
  formData: FormData,
): Promise<{ error?: string }> {
  const itemId = (formData.get('item_id') as string | null)?.trim()
  if (!itemId) return { error: 'missing item_id' }

  const raw: Record<string, FormDataEntryValue | null> = {}
  for (const key of [
    'count',
    'stone_type',
    'cut',
    'carat',
    'is_total_carat',
    'color',
    'clarity',
    'certificate',
    'position',
    'notes',
  ]) {
    raw[key] = formData.get(key)
  }
  const parsed = inventoryStoneSchema.safeParse(raw)
  if (!parsed.success) return { error: 'validation_failed' }
  const v = parsed.data

  const { tenantId, supabase, userId } = await resolveItemTenant(itemId)

  // Compute next position if not provided.
  let position = v.position
  if (!position || position === 0) {
    const { data } = await supabase
      .from('inventory_item_stones')
      .select('position')
      .eq('item_id', itemId)
      .is('deleted_at', null)
      .order('position', { ascending: false })
      .limit(1)
    position = (data?.[0]?.position ?? -1) + 1
  }

  const { data: stoneRow, error } = await supabase
    .from('inventory_item_stones')
    .insert({
      tenant_id: tenantId,
      item_id: itemId,
      count: v.count,
      stone_type: v.stone_type,
      cut: v.cut,
      carat: v.carat,
      is_total_carat: v.is_total_carat,
      color: v.color,
      clarity: v.clarity,
      certificate: v.certificate,
      position,
      notes: v.notes,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  if (stoneRow?.id) {
    await logAudit({
      tenantId,
      userId,
      action: 'stone_add',
      tableName: 'inventory_item_stones',
      recordId: stoneRow.id,
      changes: {
        item_id: itemId,
        count: v.count,
        stone_type: v.stone_type,
        carat: v.carat,
      },
    })
  }

  revalidatePath(`/inventory/${itemId}`)
  return {}
}

export async function deleteInventoryStoneAction(
  formData: FormData,
): Promise<void> {
  const stoneId = (formData.get('stone_id') as string | null)?.trim()
  const itemId = (formData.get('item_id') as string | null)?.trim()
  if (!stoneId || !itemId) return

  const { tenantId, supabase, userId } = await resolveItemTenant(itemId)

  await supabase
    .from('inventory_item_stones')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', stoneId)
    .eq('item_id', itemId)
    .eq('tenant_id', tenantId)

  await logAudit({
    tenantId,
    userId,
    action: 'stone_delete',
    tableName: 'inventory_item_stones',
    recordId: stoneId,
    changes: { item_id: itemId },
  })

  revalidatePath(`/inventory/${itemId}`)
}
