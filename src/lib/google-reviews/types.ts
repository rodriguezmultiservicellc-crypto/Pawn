// src/lib/google-reviews/types.ts

/**
 * Shape of a single review as returned by Google Places Details API.
 * We accept the raw shape but only use the listed fields.
 */
export type GoogleReview = {
  author_name: string
  author_url?: string | null
  profile_photo_url?: string | null
  rating: number              // 1–5 integer
  relative_time_description?: string | null  // localized by Google; we re-render via Intl
  text?: string | null
  time: number                // unix seconds
}

/**
 * Subset of the Places Details payload we care about. The full payload
 * has many more fields; we only persist what we use to keep the JSONB
 * row lean.
 */
export type PlaceDetails = {
  name?: string
  rating?: number              // aggregate (e.g. 4.7)
  user_ratings_total?: number  // total review count on Google
  reviews?: GoogleReview[]     // up to 5
  url?: string                 // canonical Google maps URL for the place
  business_status?: 'OPERATIONAL' | 'CLOSED_TEMPORARILY' | 'CLOSED_PERMANENTLY'
}

/**
 * Row shape for tenant_google_reviews. `payload` carries a PlaceDetails
 * payload (typed as unknown JSON when read from the DB; narrowed by
 * cache.ts before use).
 */
export type TenantReviewRow = {
  tenant_id: string
  place_id: string
  payload: PlaceDetails
  rating: number | null
  total_review_count: number | null
  fetched_at: string           // ISO timestamp
  last_error: string | null
  last_error_at: string | null
}

/**
 * The shape passed from RSC to the public widget. Only the fields the
 * widget actually renders. `loadPublicReviews` returns this or null.
 */
export type RenderableReviews = {
  rating: number               // aggregate, never null at this layer
  totalReviewCount: number     // aggregate, never null at this layer
  reviews: GoogleReview[]      // already filtered + sorted + capped at 3
  placeUrl: string | null
  fetchedAt: string            // ISO; for last-sync tooling later
}
