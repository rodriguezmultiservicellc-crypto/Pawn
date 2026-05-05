// src/app/(staff)/settings/integrations/google-reviews/actions.ts
'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit'
import { googleReviewsSettingsSchema } from '@/lib/validations/google-reviews'
import { refreshReviews } from '@/lib/google-reviews/cache'

const SETTINGS_ROLES = ['owner', 'chain_admin'] as const

export type UpdateGoogleReviewsSettingsState = {
  error?: string
  fieldErrors?: Record<string, string>
  ok?: boolean
}

export async function updateGoogleReviewsSettingsAction(
  _prev: UpdateGoogleReviewsSettingsState,
  formData: FormData,
): Promise<UpdateGoogleReviewsSettingsState> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  await requireRoleInTenant(ctx.tenantId, SETTINGS_ROLES)

  const parsed = googleReviewsSettingsSchema.safeParse({
    google_place_id: formData.get('google_place_id'),
    google_reviews_min_star_floor: formData.get('google_reviews_min_star_floor'),
    google_places_api_key: formData.get('google_places_api_key'),
  })
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const k = String(issue.path[0] ?? '')
      if (k && !fieldErrors[k]) fieldErrors[k] = issue.message
    }
    return { error: 'validation_failed', fieldErrors }
  }
  const v = parsed.data

  const admin = createAdminClient()

  const { data: prior } = await admin
    .from('settings')
    .select(
      'google_place_id, google_places_api_key, google_reviews_min_star_floor',
    )
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle()

  const { error } = await admin
    .from('settings')
    .update({
      google_place_id: v.google_place_id,
      google_places_api_key: v.google_places_api_key,
      google_reviews_min_star_floor: v.google_reviews_min_star_floor,
    })
    .eq('tenant_id', ctx.tenantId)
  if (error) return { error: error.message }

  // If place_id was cleared, drop the cache row so /settings shows
  // "Not configured" cleanly. (The implicit gate is google_place_id IS
  // NOT NULL — without this, a stale row with the previous place_id
  // would linger.)
  if (v.google_place_id === null && prior?.google_place_id) {
    await admin
      .from('tenant_google_reviews')
      .delete()
      .eq('tenant_id', ctx.tenantId)
  }

  await logAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: 'update',
    tableName: 'settings',
    recordId: ctx.tenantId,
    changes: {
      kind: 'google_reviews_settings',
      before: prior,
      after: v,
    },
  })

  revalidatePath('/settings/integrations')
  revalidatePath('/settings/integrations/google-reviews')
  return { ok: true }
}

/**
 * Test-connection action — fires a single Places API call and writes
 * the result to tenant_google_reviews. Operator-driven smoke test
 * that doesn't wait for cache TTL or a real visitor.
 */
export type TestConnectionState = {
  ok?: boolean
  error?: string
  rating?: number | null
  totalReviewCount?: number | null
}

export async function testGoogleReviewsConnectionAction(
  _prev: TestConnectionState,
  _formData: FormData,
): Promise<TestConnectionState> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  await requireRoleInTenant(ctx.tenantId, SETTINGS_ROLES)

  const row = await refreshReviews(ctx.tenantId)
  if (!row) return { error: 'no_place_id_or_settings' }
  if (row.last_error) return { error: row.last_error }

  revalidatePath('/settings/integrations')
  revalidatePath('/settings/integrations/google-reviews')

  return {
    ok: true,
    rating: row.rating,
    totalReviewCount: row.total_review_count,
  }
}
