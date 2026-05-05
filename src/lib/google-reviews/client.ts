// src/lib/google-reviews/client.ts
import 'server-only'
import type { PlaceDetails } from './types'

const BASE_URL = 'https://maps.googleapis.com/maps/api/place/details/json'
const FIELDS = 'rating,user_ratings_total,reviews,url,name,business_status'

/**
 * Fetch Place Details for a single place_id. Never throws. Returns either
 * the parsed payload or `{error: string}` describing what went wrong.
 *
 * The caller resolves the API key (per-tenant override → platform env
 * fallback) before calling — `client.ts` is a pure HTTP wrapper.
 *
 * Network-level fetch errors and non-OK Google statuses both surface as
 * `{error}`. The error string is stored verbatim in
 * tenant_google_reviews.last_error and shown to the operator (not to
 * end users), so it can be terse and English-only.
 */
export async function fetchPlaceDetails(opts: {
  placeId: string
  apiKey: string
  language?: 'en' | 'es'
}): Promise<PlaceDetails | { error: string }> {
  const url = new URL(BASE_URL)
  url.searchParams.set('place_id', opts.placeId)
  url.searchParams.set('key', opts.apiKey)
  url.searchParams.set('fields', FIELDS)
  // Hardcode 'en' for cache stability — Google's `relative_time_description`
  // string is the only locale-specific field, and we re-render that via
  // Intl on the client.
  url.searchParams.set('language', opts.language ?? 'en')

  let res: Response
  try {
    res = await fetch(url.toString(), {
      // No `cache: 'force-cache'` — caller's DB cache is the cache layer.
      cache: 'no-store',
    })
  } catch (e) {
    return { error: `network: ${e instanceof Error ? e.message : 'unknown'}` }
  }

  if (!res.ok) {
    return { error: `http_${res.status}` }
  }

  let body: unknown
  try {
    body = await res.json()
  } catch {
    return { error: 'invalid_json' }
  }

  if (!body || typeof body !== 'object') {
    return { error: 'invalid_json' }
  }

  const status = (body as { status?: string }).status
  if (status && status !== 'OK') {
    // Google statuses include NOT_FOUND, INVALID_REQUEST, OVER_QUERY_LIMIT,
    // REQUEST_DENIED, ZERO_RESULTS, UNKNOWN_ERROR. We pass through verbatim
    // so the operator sees Google's own error language.
    return { error: status.toLowerCase() }
  }

  const result = (body as { result?: PlaceDetails }).result
  if (!result) {
    return { error: 'no_result' }
  }

  // Normalize: Google returns up to 5 reviews; cap defensively in case
  // the response shape ever exceeds.
  if (result.reviews && result.reviews.length > 5) {
    result.reviews = result.reviews.slice(0, 5)
  }

  return result
}
