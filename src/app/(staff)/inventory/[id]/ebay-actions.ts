'use server'

/**
 * Inventory-detail eBay-panel server actions.
 *
 * Bound onto src/app/(staff)/inventory/[id]/page.tsx via the
 * InventoryEbayPanel component. Each call:
 *   1. Resolves the inventory item's tenant (defense in depth).
 *   2. Calls requireStaff(tenantId).
 *   3. Delegates to the matching lib/ebay/listings helper (currently STUB).
 *   4. Writes an audit_log row.
 *   5. Revalidates the inventory item page.
 */

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/supabase/ctx'
import { requireStaff } from '@/lib/supabase/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit'
import {
  createOffer,
  endListing,
  publishOffer,
  syncListing,
  updateListing,
} from '@/lib/ebay/listings'
import type {
  EbayListingFormat,
  EbayListingInsert,
  EbayListingRow,
  EbayListingUpdate,
} from '@/types/database-aliases'

export type EbayPanelActionResult =
  | { ok: true; listingId: string }
  | { ok: false; error: string }

export type EbayPanelSimpleResult = { ok: true } | { ok: false; error: string }

async function resolveItemTenant(itemId: string) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')

  const admin = createAdminClient()
  const { data: item } = await admin
    .from('inventory_items')
    .select('tenant_id, sku')
    .eq('id', itemId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!item) redirect('/inventory')

  await requireStaff(item.tenant_id)
  return { tenantId: item.tenant_id, sku: item.sku, userId: ctx.userId }
}

function parsePhotoUrls(value: FormDataEntryValue | null): string[] {
  if (typeof value !== 'string' || !value) return []
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((u): u is string => typeof u === 'string' && u.length > 0)
  } catch {
    return []
  }
}

function parseFormat(value: FormDataEntryValue | null): EbayListingFormat {
  return value === 'AUCTION' ? 'AUCTION' : 'FIXED_PRICE'
}

function parseFloatStrict(value: FormDataEntryValue | null): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function parseIntStrict(value: FormDataEntryValue | null): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  const n = Math.floor(Number(value))
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Create a new draft ebay_listings row tied to an inventory item. */
export async function createEbayDraftAction(
  formData: FormData,
): Promise<EbayPanelActionResult> {
  const itemId = (formData.get('inventory_item_id') as string | null) ?? ''
  if (!itemId) return { ok: false, error: 'missing_item' }
  const { tenantId, sku, userId } = await resolveItemTenant(itemId)

  const title = (formData.get('title') as string | null)?.trim() ?? ''
  const conditionId = (formData.get('condition_id') as string | null)?.trim() ?? ''
  const categoryId = (formData.get('category_id') as string | null)?.trim() ?? ''
  const description = (formData.get('description') as string | null) ?? ''
  const marketingMessage =
    (formData.get('marketing_message') as string | null)?.trim() || null
  const format = parseFormat(formData.get('format'))
  const listPrice = parseFloatStrict(formData.get('list_price'))
  const currency = (formData.get('currency') as string | null)?.trim() || 'USD'
  const quantity = parseIntStrict(formData.get('quantity')) ?? 1
  const photoUrls = parsePhotoUrls(formData.get('photo_urls'))

  if (!title) return { ok: false, error: 'title_required' }
  if (!conditionId) return { ok: false, error: 'condition_required' }
  if (!categoryId) return { ok: false, error: 'category_required' }
  if (listPrice == null || listPrice < 0) {
    return { ok: false, error: 'list_price_required' }
  }
  if (!description) return { ok: false, error: 'description_required' }

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supa = admin as any
  const insert: EbayListingInsert = {
    tenant_id: tenantId,
    inventory_item_id: itemId,
    ebay_sku: sku,
    title,
    condition_id: conditionId,
    category_id: categoryId,
    format,
    list_price: listPrice,
    currency,
    quantity,
    description,
    marketing_message: marketingMessage,
    photo_urls: photoUrls,
    status: 'draft',
    created_by: userId,
    updated_by: userId,
  }
  const { data: created, error } = await supa
    .from('ebay_listings')
    .insert(insert)
    .select('id')
    .single()
  if (error || !created) {
    return { ok: false, error: error?.message ?? 'insert_failed' }
  }
  const listingId = (created as { id: string }).id

  await logAudit({
    tenantId,
    userId,
    action: 'ebay_listing_create',
    tableName: 'ebay_listings',
    recordId: listingId,
    changes: { title, sku, format, list_price: listPrice, currency, quantity },
  })

  revalidatePath(`/inventory/${itemId}`)
  return { ok: true, listingId }
}

/** Patch an existing ebay_listings draft / live row. */
export async function updateEbayDraftAction(
  listingId: string,
  formData: FormData,
): Promise<EbayPanelActionResult> {
  const itemId = (formData.get('inventory_item_id') as string | null) ?? ''
  if (!itemId) return { ok: false, error: 'missing_item' }
  const { tenantId, userId } = await resolveItemTenant(itemId)

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supa = admin as any

  // Verify the listing belongs to the same tenant + item.
  const { data: existing } = (await supa
    .from('ebay_listings')
    .select('id, tenant_id, inventory_item_id, status, ebay_offer_id')
    .eq('id', listingId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle()) as { data: EbayListingRow | null }
  if (!existing || existing.inventory_item_id !== itemId) {
    return { ok: false, error: 'listing_not_found' }
  }

  const title = (formData.get('title') as string | null)?.trim() ?? ''
  const conditionId = (formData.get('condition_id') as string | null)?.trim() ?? ''
  const categoryId = (formData.get('category_id') as string | null)?.trim() ?? ''
  const description = (formData.get('description') as string | null) ?? ''
  const marketingMessage =
    (formData.get('marketing_message') as string | null)?.trim() || null
  const format = parseFormat(formData.get('format'))
  const listPrice = parseFloatStrict(formData.get('list_price'))
  const currency = (formData.get('currency') as string | null)?.trim() || 'USD'
  const quantity = parseIntStrict(formData.get('quantity')) ?? 1
  const photoUrls = parsePhotoUrls(formData.get('photo_urls'))

  if (!title) return { ok: false, error: 'title_required' }

  const update: EbayListingUpdate = {
    title,
    condition_id: conditionId,
    category_id: categoryId,
    format,
    list_price: listPrice ?? 0,
    currency,
    quantity,
    description,
    marketing_message: marketingMessage,
    photo_urls: photoUrls,
    updated_by: userId,
  }

  const { error: updateErr } = await supa
    .from('ebay_listings')
    .update(update)
    .eq('id', listingId)
    .eq('tenant_id', tenantId)
  if (updateErr) {
    return { ok: false, error: updateErr.message }
  }

  // If the listing is already live on eBay, propagate the patch to eBay
  // (STUB) so view_count / watcher_count + the live listing reflect.
  if (existing.status === 'active' && existing.ebay_offer_id) {
    try {
      await updateListing({
        tenantId,
        listingId,
        patch: {
          listingId,
          inventoryItemId: itemId,
          ebaySku: existing.ebay_sku ?? '',
          title,
          conditionId,
          categoryId,
          format,
          listPrice: listPrice ?? 0,
          currency,
          quantity,
          description,
          marketingMessage,
          photoUrls,
        },
      })
    } catch (err) {
      console.error('[ebay] updateListing failed', err)
    }
  }

  await logAudit({
    tenantId,
    userId,
    action: 'ebay_listing_update',
    tableName: 'ebay_listings',
    recordId: listingId,
    changes: { title, format, list_price: listPrice, currency, quantity },
  })

  revalidatePath(`/inventory/${itemId}`)
  return { ok: true, listingId }
}

/** Publish a draft via the Sell Inventory API (STUBBED). */
export async function publishEbayListingAction(
  listingId: string,
): Promise<EbayPanelSimpleResult> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supa = admin as any
  const { data: existing } = (await supa
    .from('ebay_listings')
    .select(
      'id, tenant_id, inventory_item_id, status, ebay_offer_id, ebay_sku, title, condition_id, category_id, format, list_price, currency, quantity, description, marketing_message, photo_urls',
    )
    .eq('id', listingId)
    .is('deleted_at', null)
    .maybeSingle()) as { data: EbayListingRow | null }
  if (!existing) return { ok: false, error: 'listing_not_found' }

  await requireStaff(existing.tenant_id)

  try {
    // 1) createOffer if we don't have one yet.
    let offerId = existing.ebay_offer_id
    if (!offerId) {
      const created = await createOffer({
        tenantId: existing.tenant_id,
        draft: {
          listingId,
          inventoryItemId: existing.inventory_item_id,
          ebaySku: existing.ebay_sku ?? `INV-${listingId.slice(0, 8)}`,
          title: existing.title,
          conditionId: existing.condition_id,
          categoryId: existing.category_id,
          format: existing.format,
          listPrice: Number(existing.list_price),
          currency: existing.currency,
          quantity: existing.quantity,
          description: existing.description,
          marketingMessage: existing.marketing_message,
          photoUrls: existing.photo_urls ?? [],
        },
      })
      offerId = created.offerId
    }

    // 2) publish the offer.
    await publishOffer({ tenantId: existing.tenant_id, listingId, offerId })

    await logAudit({
      tenantId: existing.tenant_id,
      userId: ctx.userId,
      action: 'ebay_listing_publish',
      tableName: 'ebay_listings',
      recordId: listingId,
      changes: { offer_id: offerId },
    })

    revalidatePath(`/inventory/${existing.inventory_item_id}`)
    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'publish_failed'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = admin as any
    await sb
      .from('ebay_listings')
      .update({ status: 'error', error_text: msg })
      .eq('id', listingId)
    revalidatePath(`/inventory/${existing.inventory_item_id}`)
    return { ok: false, error: msg }
  }
}

/** End an active listing (STUBBED). */
export async function endEbayListingAction(
  listingId: string,
  reason = 'NOT_AVAILABLE',
): Promise<EbayPanelSimpleResult> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supa = admin as any
  const { data: existing } = (await supa
    .from('ebay_listings')
    .select('id, tenant_id, inventory_item_id, status')
    .eq('id', listingId)
    .is('deleted_at', null)
    .maybeSingle()) as {
    data: Pick<
      EbayListingRow,
      'id' | 'tenant_id' | 'inventory_item_id' | 'status'
    > | null
  }
  if (!existing) return { ok: false, error: 'listing_not_found' }

  await requireStaff(existing.tenant_id)

  try {
    await endListing({
      tenantId: existing.tenant_id,
      listingId,
      reason,
    })
    await logAudit({
      tenantId: existing.tenant_id,
      userId: ctx.userId,
      action: 'ebay_listing_end',
      tableName: 'ebay_listings',
      recordId: listingId,
      changes: { reason },
    })
    revalidatePath(`/inventory/${existing.inventory_item_id}`)
    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'end_failed'
    return { ok: false, error: msg }
  }
}

/** Manually sync a single listing's view + watcher counts (STUBBED). */
export async function syncEbayListingAction(
  listingId: string,
): Promise<EbayPanelSimpleResult> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supa = admin as any
  const { data: existing } = (await supa
    .from('ebay_listings')
    .select('id, tenant_id, inventory_item_id')
    .eq('id', listingId)
    .is('deleted_at', null)
    .maybeSingle()) as {
    data: Pick<
      EbayListingRow,
      'id' | 'tenant_id' | 'inventory_item_id'
    > | null
  }
  if (!existing) return { ok: false, error: 'listing_not_found' }

  await requireStaff(existing.tenant_id)

  try {
    await syncListing({ tenantId: existing.tenant_id, listingId })
    await logAudit({
      tenantId: existing.tenant_id,
      userId: ctx.userId,
      action: 'ebay_listing_sync',
      tableName: 'ebay_listings',
      recordId: listingId,
      changes: null,
    })
    revalidatePath(`/inventory/${existing.inventory_item_id}`)
    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'sync_failed'
    return { ok: false, error: msg }
  }
}
