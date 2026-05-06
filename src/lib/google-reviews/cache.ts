// src/lib/google-reviews/cache.ts
import 'server-only'
import { after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getTenantSecret } from '@/lib/secrets/vault'
import { fetchPlaceDetails } from './client'
import { applyHiddenFilter, applyMinStarFloor, isWidgetRenderable } from './filter'
import type {
  PlaceDetails,
  RenderableReviews,
  TenantReviewRow,
} from './types'

const TTL_MS = 24 * 60 * 60 * 1000 // 24h

/**
 * Platform-default cap on Places API calls per tenant per rolling 24h
 * window. Per-tenant override via `settings.google_reviews_daily_quota`
 * (NULL → use this default). Counts both successes and failures so the
 * cap protects against retry storms when a row stays stale-with-error.
 *
 * 50 covers normal traffic comfortably: cron warmer + organic public
 * page hits typically resolve to 1–2 fetches per tenant per 24h thanks
 * to the cache TTL. This cap exists for misconfiguration / API outage
 * edge cases, not for steady-state traffic shaping.
 */
const PLATFORM_DAILY_QUOTA = 50

/**
 * Returns the cache row for a tenant — fresh, stale, or null.
 *
 * Logic:
 *   1. SELECT row from tenant_google_reviews.
 *   2. If row exists AND row.place_id matches settings.google_place_id
 *      AND fetched_at within TTL → return row (hot path).
 *   3. If row exists but stale → return row immediately, schedule
 *      refreshReviews() via Next.js `after()` so it completes after the
 *      response is sent (reliable in serverless). Next visitor sees fresh.
 *   4. If no row OR place_id mismatch → await refreshReviews() and return
 *      whatever it returns. First-visitor latency.
 *
 * Never throws. Failure surfaces as null (and last_error gets written
 * inside refreshReviews).
 */
export async function getCachedReviews(
  tenantId: string,
): Promise<TenantReviewRow | null> {
  const admin = createAdminClient()

  const [{ data: settings }, { data: cached }] = await Promise.all([
    admin
      .from('settings')
      .select('google_place_id')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    admin
      .from('tenant_google_reviews')
      .select('*')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
  ])

  const placeId = settings?.google_place_id ?? null
  if (!placeId) return null

  const cachedRow = cached as TenantReviewRow | null

  if (cachedRow && cachedRow.place_id === placeId) {
    const age = Date.now() - new Date(cachedRow.fetched_at).getTime()
    if (age < TTL_MS) {
      // Hot path — fresh.
      return cachedRow
    }
    // Stale — serve immediately, refresh in background. `after()` registers
    // the callback with the runtime's waitUntil so it completes after the
    // response is sent (reliable in serverless; Next 16 stable API). Without
    // it, the background promise can be killed when the request scope ends.
    after(() => refreshReviews(tenantId))
    return cachedRow
  }

  // No row OR place_id mismatch — must await fresh fetch. First-visitor
  // latency (~150ms typical Places API). Subsequent visitors hit the hot
  // path until TTL expires.
  return refreshReviews(tenantId)
}

/**
 * Synchronous fetch + write. Returns the new row, or null on error.
 *
 * On error, UPSERTs last_error / last_error_at WITHOUT overwriting the
 * previous good payload. Stale data keeps serving so a transient Google
 * outage doesn't blank the public landing.
 */
export async function refreshReviews(
  tenantId: string,
): Promise<TenantReviewRow | null> {
  const admin = createAdminClient()

  const [{ data: settings }, tenantOverride] = await Promise.all([
    admin
      .from('settings')
      .select('google_place_id, google_reviews_daily_quota')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    getTenantSecret(tenantId, 'google_places_api_key'),
  ])

  const placeId = settings?.google_place_id ?? null
  if (!placeId) return null

  // Resolution order: per-tenant vault override → platform env var.
  const apiKey = tenantOverride ?? process.env.GOOGLE_PLACES_API_KEY ?? ''
  if (!apiKey) {
    await writeError(tenantId, placeId, 'no_api_key')
    return loadCachedRow(tenantId)
  }

  // Quota guardrail. consume_google_reviews_quota is an atomic SECURITY
  // DEFINER RPC that locks the cache row, resets the rolling 24h window
  // if elapsed, increments calls_used, and returns FALSE when the cap is
  // hit. We charge the call before fetching so retry storms during a
  // Google outage cannot blow past the cap.
  const cap = settings?.google_reviews_daily_quota ?? PLATFORM_DAILY_QUOTA
  const { data: allowed, error: quotaErr } = await admin.rpc(
    'consume_google_reviews_quota',
    { p_tenant_id: tenantId, p_place_id: placeId, p_cap: cap },
  )
  if (quotaErr) {
    // RPC error itself — log + degrade open. Failing closed on a quota
    // service hiccup would silently break public widgets for everyone.
    console.error(
      '[google-reviews.cache] quota RPC failed; allowing call',
      quotaErr.message,
    )
  } else if (allowed === false) {
    await writeError(tenantId, placeId, 'quota_exceeded')
    return loadCachedRow(tenantId)
  }

  const result = await fetchPlaceDetails({ placeId, apiKey })

  if ('error' in result) {
    await writeError(tenantId, placeId, result.error)
    return loadCachedRow(tenantId)
  }

  // Success — UPSERT the row, clearing any prior error.
  const now = new Date().toISOString()
  const rating =
    typeof result.rating === 'number' && Number.isFinite(result.rating)
      ? result.rating
      : null
  const total =
    typeof result.user_ratings_total === 'number' &&
    Number.isFinite(result.user_ratings_total)
      ? result.user_ratings_total
      : null

  const { data, error } = await admin
    .from('tenant_google_reviews')
    .upsert(
      {
        tenant_id: tenantId,
        place_id: placeId,
        payload: result as unknown as PlaceDetails,
        rating,
        total_review_count: total,
        fetched_at: now,
        last_error: null,
        last_error_at: null,
      },
      { onConflict: 'tenant_id' },
    )
    .select('*')
    .maybeSingle()

  if (error || !data) return null
  return data as TenantReviewRow
}

/**
 * Public-surface adapter. Composes getCachedReviews + applyMinStarFloor +
 * isWidgetRenderable. Returns the renderable shape or null.
 *
 * Called from the (public)/s/[slug]/page.tsx RSC. Takes tenantId only —
 * reads google_reviews_min_star_floor from settings via the admin client
 * (the public route's anon SSR client cannot read settings, but the
 * tenantId is already validated as a published tenant by fetchPublicTenant
 * upstream, so the admin-client read is safe).
 */
export async function loadPublicReviews(
  tenantId: string,
): Promise<RenderableReviews | null> {
  const admin = createAdminClient()

  const [{ data: settings }, row] = await Promise.all([
    admin
      .from('settings')
      .select(
        'google_reviews_min_star_floor, google_reviews_hidden_review_times',
      )
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    getCachedReviews(tenantId),
  ])

  if (!row) return null

  const minStarFloor = settings?.google_reviews_min_star_floor ?? 4
  const hiddenTimes = settings?.google_reviews_hidden_review_times ?? []

  // Apply hidden filter before star-floor — hidden takes precedence and
  // shrinking the array first is faster on larger inputs (no-op for the
  // 3-to-5 review payloads we actually see).
  const visibleReviews = applyHiddenFilter(
    row.payload.reviews ?? [],
    hiddenTimes,
  )
  const filteredReviews = applyMinStarFloor(visibleReviews, minStarFloor)
  const renderable = isWidgetRenderable({
    fetchedAt: new Date(row.fetched_at),
    filteredReviews,
  })
  if (!renderable) return null

  if (row.rating == null || row.total_review_count == null) return null

  return {
    rating: row.rating,
    totalReviewCount: row.total_review_count,
    reviews: filteredReviews,
    placeUrl: row.payload.url ?? null,
    fetchedAt: row.fetched_at,
  }
}

// ── Internals ─────────────────────────────────────────────────────────────

async function loadCachedRow(tenantId: string): Promise<TenantReviewRow | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('tenant_google_reviews')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  return (data as TenantReviewRow | null) ?? null
}

async function writeError(
  tenantId: string,
  placeId: string,
  message: string,
): Promise<void> {
  const admin = createAdminClient()
  const now = new Date().toISOString()

  // Two cases: row exists (UPDATE last_error fields), or row doesn't
  // exist yet (INSERT a placeholder row with empty payload). The
  // placeholder lets the operator see "Last sync failed" in /settings
  // even if we've never had a successful fetch.
  const { data: existing } = await admin
    .from('tenant_google_reviews')
    .select('tenant_id')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (existing) {
    await admin
      .from('tenant_google_reviews')
      .update({ last_error: message, last_error_at: now })
      .eq('tenant_id', tenantId)
  } else {
    const { error: insertErr } = await admin.from('tenant_google_reviews').insert({
      tenant_id: tenantId,
      place_id: placeId,
      payload: {},
      rating: null,
      total_review_count: null,
      fetched_at: now, // placeholder; gets overwritten on first success
      last_error: message,
      last_error_at: now,
    })
    // PK collision (23505) means a concurrent success-UPSERT beat us — benign,
    // since the row is now valid and the error we were trying to record is
    // stale anyway. Anything else is worth a server log.
    if (insertErr && (insertErr as { code?: string }).code !== '23505') {
      console.error('[google-reviews.cache] writeError insert failed', insertErr)
    }
  }
}
