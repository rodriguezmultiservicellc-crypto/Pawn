/**
 * eBay client — shared type definitions.
 *
 * SCAFFOLD PHASE: every helper that touches network in lib/ebay/* is currently
 * a STUB. These types describe the in-app shape we settle for; the real eBay
 * Sell Inventory API responses are a strict superset of what we keep.
 */

import type {
  EbayEnvironment,
  EbayListingFormat,
  EbayListingStatus,
} from '@/types/database-aliases'

/** OAuth token bundle stored on tenant_ebay_credentials. */
export type EbayTokenBundle = {
  ebay_user_id: string | null
  refresh_token: string
  refresh_token_expires_at: string // ISO
  access_token: string
  access_token_expires_at: string // ISO
  environment: EbayEnvironment
}

/** Resolved credentials with derived API base URL — what every eBay call needs. */
export type ResolvedEbayCredentials = {
  tenantId: string
  ebayUserId: string | null
  accessToken: string
  environment: EbayEnvironment
  siteId: string
  apiBase: string // 'https://api.ebay.com' or 'https://api.sandbox.ebay.com'
  merchantLocationKey: string | null
  fulfillmentPolicyId: string | null
  paymentPolicyId: string | null
  returnPolicyId: string | null
}

/**
 * Caller-supplied draft used by createOffer + publishOffer. Mirrors the
 * Sell Inventory API "createOffer" payload structure but typed loosely so
 * we can extend without churn.
 */
export type EbayListingDraft = {
  listingId: string // local ebay_listings.id
  inventoryItemId: string
  ebaySku: string
  title: string
  conditionId: string
  categoryId: string
  format: EbayListingFormat
  listPrice: number
  currency: string
  quantity: number
  description: string
  marketingMessage: string | null
  photoUrls: string[]
}

/** Plausibly-shaped mock response from createOffer. */
export type EbayCreateOfferResult = {
  offerId: string
}

/** Plausibly-shaped mock response from publishOffer. */
export type EbayPublishResult = {
  offerId: string
  listingId: string
  status: EbayListingStatus // 'active' on success
}

/** Snapshot used by syncListing to refresh counts. */
export type EbayListingSnapshot = {
  listingId: string
  status: EbayListingStatus
  viewCount: number | null
  watcherCount: number | null
  lastSyncedAt: string // ISO
}

/** Mock eBay order returned by fetchOrders — minimum we need to book a sale. */
export type EbayOrder = {
  orderId: string
  ebaySku: string
  ebayListingId: string | null
  buyerUsername: string | null
  buyerEmail: string | null
  pricePaid: number
  currency: string
  paidAt: string // ISO
}
