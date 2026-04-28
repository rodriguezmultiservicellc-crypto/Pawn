/**
 * eBay listing operations — high-level wrappers that map our DB rows to
 * eBay's Sell Inventory + Sell Marketing API surface.
 *
 * STUB STAGE — every function delegates to ebayFetch with mock responses.
 * The DB-side persistence (status updates, ebay_offer_id / ebay_listing_id
 * round-tripping) IS real, so the UI reflects state changes and the audit
 * trail is intact.
 *
 * REAL WIRE-UP plan (Sell Inventory API):
 *   1. PUT  /sell/inventory/v1/inventory_item/{sku}   (creates the catalog row)
 *   2. POST /sell/inventory/v1/offer                  (creates the offer)
 *   3. POST /sell/inventory/v1/offer/{offerId}/publish (mints listing id)
 *   4. POST /sell/inventory/v1/offer/{offerId}/withdraw (ends listing)
 *   5. GET  /sell/marketing/v1/ad?listingIds=...      (view counts)
 *   6. GET  /sell/fulfillment/v1/order?filter=creationdate:[since..]
 *
 * We pick Sell Inventory over the legacy Trading API because:
 *   - JSON-only (Trading API is XML/SOAP).
 *   - Same OAuth flow as the rest of eBay's Sell platform.
 *   - Better catalog reuse (one inventory item -> many offers across sites).
 *
 * Server-only — never import from a client component.
 */

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCredentials } from './auth'
import { ebayFetch, writeEvent } from './client'
import type {
  EbayListingDraft,
  EbayCreateOfferResult,
  EbayPublishResult,
  EbayListingSnapshot,
  EbayOrder,
} from './types'
import type {
  EbayListingRow,
  EbayListingUpdate,
} from '@/types/database-aliases'

/**
 * STUB — replace with real eBay Sell API call when credentials wired.
 *
 * Real impl: PUT /sell/inventory/v1/inventory_item/{sku} with the catalog
 * payload (title, condition, weight, etc.), then POST /offer with pricing
 * + policies. Both calls bind via the SKU.
 *
 * Stub: validates creds, writes a create_offer event, fabricates an offer
 * id, persists ebay_offer_id on the local row, and returns the offer id.
 */
export async function createOffer(args: {
  tenantId: string
  draft: EbayListingDraft
}): Promise<EbayCreateOfferResult> {
  // resolveCredentials throws 'tenant_ebay_not_connected' if not connected.
  // Calling here also validates merchant_location_key + policy ids exist.
  const creds = await resolveCredentials(args.tenantId)
  const missing: string[] = []
  if (!creds.merchantLocationKey) missing.push('merchant_location_key')
  if (!creds.fulfillmentPolicyId) missing.push('fulfillment_policy_id')
  if (!creds.paymentPolicyId) missing.push('payment_policy_id')
  if (!creds.returnPolicyId) missing.push('return_policy_id')
  if (missing.length > 0) {
    await writeEvent({
      tenantId: args.tenantId,
      listingId: args.draft.listingId,
      kind: 'create_offer',
      requestPayload: { sku: args.draft.ebaySku },
      responsePayload: null,
      httpStatus: null,
      errorText: `missing_policy_config: ${missing.join(',')}`,
    })
    throw new Error(`tenant_ebay_missing_config: ${missing.join(',')}`)
  }

  const offerBody = {
    sku: args.draft.ebaySku,
    marketplaceId: creds.siteId,
    format: args.draft.format,
    availableQuantity: args.draft.quantity,
    categoryId: args.draft.categoryId,
    listingDescription: args.draft.description,
    listingPolicies: {
      fulfillmentPolicyId: creds.fulfillmentPolicyId,
      paymentPolicyId: creds.paymentPolicyId,
      returnPolicyId: creds.returnPolicyId,
    },
    pricingSummary: {
      price: {
        value: args.draft.listPrice.toFixed(2),
        currency: args.draft.currency,
      },
    },
    merchantLocationKey: creds.merchantLocationKey,
  }

  const stubOfferId = `STUB-OFFER-${args.draft.listingId.slice(0, 8)}-${Date.now()}`
  await ebayFetch<{ offerId: string }>({
    tenantId: args.tenantId,
    path: '/sell/inventory/v1/offer',
    init: { method: 'POST', body: offerBody },
    mockResponse: { offerId: stubOfferId },
    eventKind: 'create_offer',
    listingId: args.draft.listingId,
  })

  await persistListingPatch(args.tenantId, args.draft.listingId, {
    ebay_offer_id: stubOfferId,
    ebay_sku: args.draft.ebaySku,
    title: args.draft.title,
    condition_id: args.draft.conditionId,
    category_id: args.draft.categoryId,
    format: args.draft.format,
    list_price: args.draft.listPrice,
    currency: args.draft.currency,
    quantity: args.draft.quantity,
    description: args.draft.description,
    marketing_message: args.draft.marketingMessage,
    photo_urls: args.draft.photoUrls,
    error_text: null,
  })

  return { offerId: stubOfferId }
}

/**
 * STUB — replace with real eBay Sell API call when credentials wired.
 *
 * Real impl: POST /sell/inventory/v1/offer/{offerId}/publish
 * Response: { listingId: string }.
 *
 * Stub: returns a synthetic listingId, flips status active, writes event.
 */
export async function publishOffer(args: {
  tenantId: string
  listingId: string
  offerId: string
}): Promise<EbayPublishResult> {
  await resolveCredentials(args.tenantId)

  await persistListingPatch(args.tenantId, args.listingId, {
    status: 'submitting',
  })

  const stubListingId = `STUB-LISTING-${args.listingId.slice(0, 8)}-${Date.now()}`
  await ebayFetch<{ listingId: string }>({
    tenantId: args.tenantId,
    path: `/sell/inventory/v1/offer/${encodeURIComponent(args.offerId)}/publish`,
    init: { method: 'POST' },
    mockResponse: { listingId: stubListingId },
    eventKind: 'publish',
    listingId: args.listingId,
  })

  await persistListingPatch(args.tenantId, args.listingId, {
    ebay_listing_id: stubListingId,
    status: 'active',
    last_synced_at: new Date().toISOString(),
    error_text: null,
  })

  return {
    offerId: args.offerId,
    listingId: stubListingId,
    status: 'active',
  }
}

/**
 * STUB — replace with real eBay Sell API call when credentials wired.
 *
 * Real impl: PUT /sell/inventory/v1/offer/{offerId} with the patched offer
 * payload. eBay updates the live listing in place when format=FIXED_PRICE.
 */
export async function updateListing(args: {
  tenantId: string
  listingId: string
  patch: Partial<EbayListingDraft>
}): Promise<void> {
  await resolveCredentials(args.tenantId)

  const row = await loadListing(args.tenantId, args.listingId)
  if (!row) throw new Error('ebay_listing_not_found')

  await ebayFetch<{ ok: boolean }>({
    tenantId: args.tenantId,
    path: `/sell/inventory/v1/offer/${encodeURIComponent(row.ebay_offer_id ?? '')}`,
    init: { method: 'PUT', body: args.patch },
    mockResponse: { ok: true },
    eventKind: 'update',
    listingId: args.listingId,
  })

  const update: EbayListingUpdate = {}
  if (args.patch.title != null) update.title = args.patch.title
  if (args.patch.conditionId != null) update.condition_id = args.patch.conditionId
  if (args.patch.categoryId != null) update.category_id = args.patch.categoryId
  if (args.patch.format != null) update.format = args.patch.format
  if (args.patch.listPrice != null) update.list_price = args.patch.listPrice
  if (args.patch.currency != null) update.currency = args.patch.currency
  if (args.patch.quantity != null) update.quantity = args.patch.quantity
  if (args.patch.description != null) update.description = args.patch.description
  if (args.patch.marketingMessage !== undefined) {
    update.marketing_message = args.patch.marketingMessage
  }
  if (args.patch.photoUrls != null) update.photo_urls = args.patch.photoUrls

  if (Object.keys(update).length > 0) {
    await persistListingPatch(args.tenantId, args.listingId, update)
  }
}

/**
 * STUB — replace with real eBay Sell API call when credentials wired.
 *
 * Real impl: POST /sell/inventory/v1/offer/{offerId}/withdraw
 */
export async function endListing(args: {
  tenantId: string
  listingId: string
  reason: string
}): Promise<void> {
  await resolveCredentials(args.tenantId)

  const row = await loadListing(args.tenantId, args.listingId)
  if (!row) throw new Error('ebay_listing_not_found')

  await ebayFetch<{ ok: boolean }>({
    tenantId: args.tenantId,
    path: `/sell/inventory/v1/offer/${encodeURIComponent(row.ebay_offer_id ?? '')}/withdraw`,
    init: { method: 'POST', body: { reason: args.reason } },
    mockResponse: { ok: true },
    eventKind: 'end',
    listingId: args.listingId,
  })

  await persistListingPatch(args.tenantId, args.listingId, {
    status: 'ended',
    last_synced_at: new Date().toISOString(),
  })
}

/**
 * STUB — replace with real eBay Sell API call when credentials wired.
 *
 * Real impl: GET /sell/marketing/v1/ad?listing_ids=<id>
 *   (or the equivalent on the buy/browse surface — eBay rate-limits the
 *    direct viewItem GET so most sellers poll the marketing surface).
 *
 * Stub: refresh view_count + watcher_count to plausible random-ish values
 * derived from the listing id so the UI reflects "something happened".
 */
export async function syncListing(args: {
  tenantId: string
  listingId: string
}): Promise<EbayListingSnapshot> {
  await resolveCredentials(args.tenantId)

  const row = await loadListing(args.tenantId, args.listingId)
  if (!row) throw new Error('ebay_listing_not_found')

  // Deterministic-ish stub counters keyed off listing id + day. Avoids
  // the UI flickering randomly between sync runs.
  const seed = hashStr(row.id + new Date().toISOString().slice(0, 10))
  const viewCount = (row.view_count ?? 0) + (seed % 7)
  const watcherCount = (row.watcher_count ?? 0) + (seed % 3)
  const lastSyncedAt = new Date().toISOString()

  await ebayFetch<{ viewCount: number; watcherCount: number }>({
    tenantId: args.tenantId,
    path: `/sell/marketing/v1/ad?listing_ids=${encodeURIComponent(row.ebay_listing_id ?? '')}`,
    init: { method: 'GET' },
    mockResponse: { viewCount, watcherCount },
    eventKind: 'sync',
    listingId: args.listingId,
  })

  await persistListingPatch(args.tenantId, args.listingId, {
    view_count: viewCount,
    watcher_count: watcherCount,
    last_synced_at: lastSyncedAt,
  })

  return {
    listingId: args.listingId,
    status: row.status,
    viewCount,
    watcherCount,
    lastSyncedAt,
  }
}

/**
 * STUB — replace with real eBay Sell API call when credentials wired.
 *
 * Real impl: GET /sell/fulfillment/v1/order?filter=creationdate:[since..]
 * Response includes line items with sku, total, buyer details. We map
 * matching SKUs back to ebay_listings, mark them sold, and book a row in
 * `sales` so reporting / register reconciliation still works.
 *
 * Stub: returns an empty array (no synthetic orders) — the operator can
 * exercise the sale-booking path manually until real orders flow.
 */
export async function fetchOrders(args: {
  tenantId: string
  sinceIso: string
}): Promise<EbayOrder[]> {
  await resolveCredentials(args.tenantId)

  await ebayFetch<{ orders: EbayOrder[] }>({
    tenantId: args.tenantId,
    path: `/sell/fulfillment/v1/order?filter=creationdate:[${args.sinceIso}..]`,
    init: { method: 'GET' },
    mockResponse: { orders: [] },
    eventKind: 'sync',
  })

  return []
}

// ── helpers ────────────────────────────────────────────────────────────────

async function loadListing(
  tenantId: string,
  listingId: string,
): Promise<EbayListingRow | null> {
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supa = admin as any
  const { data } = (await supa
    .from('ebay_listings')
    .select(
      'id, tenant_id, inventory_item_id, ebay_offer_id, ebay_listing_id, ebay_sku, title, condition_id, category_id, format, list_price, currency, quantity, description, marketing_message, photo_urls, status, error_text, last_synced_at, view_count, watcher_count, sold_at, sale_id, created_by, updated_by, created_at, updated_at, deleted_at',
    )
    .eq('tenant_id', tenantId)
    .eq('id', listingId)
    .is('deleted_at', null)
    .maybeSingle()) as { data: EbayListingRow | null }
  return data ?? null
}

async function persistListingPatch(
  tenantId: string,
  listingId: string,
  patch: EbayListingUpdate,
): Promise<void> {
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supa = admin as any
  const { error } = await supa
    .from('ebay_listings')
    .update(patch)
    .eq('tenant_id', tenantId)
    .eq('id', listingId)
  if (error) {
    console.error('[ebay] persistListingPatch failed', error.message, {
      listingId,
    })
  }
}

function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}
