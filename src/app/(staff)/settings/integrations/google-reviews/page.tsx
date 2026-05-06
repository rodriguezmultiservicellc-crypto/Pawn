// src/app/(staff)/settings/integrations/google-reviews/page.tsx
import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { createAdminClient } from '@/lib/supabase/admin'
import GoogleReviewsSettingsContent, {
  type GoogleReviewsSettingsView,
} from './content'

const SETTINGS_ROLES = new Set(['owner', 'chain_admin'])

export default async function GoogleReviewsSettingsPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  if (!ctx.tenantRole || !SETTINGS_ROLES.has(ctx.tenantRole)) {
    redirect('/settings/integrations')
  }

  const admin = createAdminClient()

  const [{ data: settings }, { data: cache }] = await Promise.all([
    admin
      .from('settings')
      .select(
        'google_place_id, google_places_api_key, google_reviews_min_star_floor, google_reviews_hidden_review_times',
      )
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle(),
    admin
      .from('tenant_google_reviews')
      .select('place_id, rating, total_review_count, fetched_at, last_error, last_error_at, payload')
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle(),
  ])

  if (!settings) redirect('/settings/integrations')

  const hiddenTimes = settings.google_reviews_hidden_review_times ?? []
  const cachedReviews =
    (cache?.payload as { reviews?: Array<Record<string, unknown>> } | null)
      ?.reviews ?? []

  const view: GoogleReviewsSettingsView = {
    placeId: settings.google_place_id ?? '',
    apiKey: settings.google_places_api_key ?? '',
    minStarFloor: settings.google_reviews_min_star_floor ?? 4,
    cache: cache
      ? {
          rating: cache.rating,
          totalReviewCount: cache.total_review_count,
          fetchedAt: cache.fetched_at,
          lastError: cache.last_error,
          lastErrorAt: cache.last_error_at,
        }
      : null,
    reviews: cachedReviews.map((r) => ({
      time: typeof r.time === 'number' ? r.time : 0,
      authorName: typeof r.author_name === 'string' ? r.author_name : '—',
      rating: typeof r.rating === 'number' ? r.rating : 0,
      text: typeof r.text === 'string' ? r.text : null,
      hidden: hiddenTimes.includes(
        typeof r.time === 'number' ? r.time : -1,
      ),
    })),
  }

  return <GoogleReviewsSettingsContent view={view} />
}
