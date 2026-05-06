/**
 * Cron — refresh tenant Google Reviews caches before TTL expires.
 *
 * Background: `tenant_google_reviews` rows have a 24h TTL
 * (`src/lib/google-reviews/cache.ts`). On the public path
 * (`/s/<slug>`), `getCachedReviews()` serves stale rows immediately and
 * refreshes via `after()` — so any tenant with public traffic stays
 * warm on its own. This cron covers the long-tail case: tenants with
 * Google Reviews configured but zero or near-zero public traffic, which
 * would otherwise hit the TTL and force the next visitor to wait on a
 * synchronous Places API call.
 *
 * Selection criteria:
 *   - settings.google_place_id IS NOT NULL  ← tenant has Reviews enabled
 *   - tenant_google_reviews row missing OR fetched_at < now - 18h
 *
 * The 18h staleness threshold is 75% of the 24h TTL — every tenant gets
 * refreshed once per ~18–24h cycle, so the public hot path always sees
 * a row aged under TTL.
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}` only. The `x-vercel-cron`
 *       header is NOT a security check — any external HTTP caller can
 *       set it. Vercel Cron sets the Authorization header automatically
 *       when CRON_SECRET is configured at the project level.
 *
 * Recommended cadence: every 6 hours (`0 *\/6 * * *`). Configured in
 * `vercel.json`. Schedule frequency does not change cost — the staleness
 * filter caps each tenant at one Places API call per ~18–24h regardless.
 *
 * Cost note: each refreshed tenant = one Places Details API call. With
 * a per-tenant API key override, the cost lands on the tenant's quota.
 * Without an override, it lands on the platform's GOOGLE_PLACES_API_KEY.
 *
 * Idempotency: a second run inside the threshold window finds zero stale
 * rows and exits cleanly. Safe to retry.
 *
 * Failure handling: each tenant refresh is isolated — one failing
 * tenant does not block the rest. `refreshReviews()` writes its own
 * `last_error` and never throws.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { refreshReviews } from '@/lib/google-reviews/cache'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STALE_THRESHOLD_MS = 18 * 60 * 60 * 1000 // 18h — 75% of the 24h TTL

type RefreshOutcome = {
  tenantId: string
  status: 'refreshed' | 'failed'
  error?: string
}

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) {
    return new NextResponse('unauthorized', { status: 401 })
  }

  const ranAt = new Date().toISOString()
  const admin = createAdminClient()

  // Configured tenants — i.e., have a place_id set in settings.
  const { data: configured, error: configuredErr } = await admin
    .from('settings')
    .select('tenant_id, google_place_id')
    .not('google_place_id', 'is', null)

  if (configuredErr) {
    return NextResponse.json(
      { ok: false, ran_at: ranAt, error: configuredErr.message },
      { status: 502 },
    )
  }

  const configuredRows = (configured ?? []) as Array<{
    tenant_id: string
    google_place_id: string | null
  }>

  if (configuredRows.length === 0) {
    return NextResponse.json({
      ok: true,
      ran_at: ranAt,
      configured: 0,
      stale: 0,
      refreshed: 0,
      failed: 0,
    })
  }

  // Existing cache rows so we know which are fresh enough to skip.
  const tenantIds = configuredRows.map((r) => r.tenant_id)
  const { data: cachedRows, error: cachedErr } = await admin
    .from('tenant_google_reviews')
    .select('tenant_id, place_id, fetched_at')
    .in('tenant_id', tenantIds)

  if (cachedErr) {
    return NextResponse.json(
      { ok: false, ran_at: ranAt, error: cachedErr.message },
      { status: 502 },
    )
  }

  const cacheByTenant = new Map<
    string,
    { place_id: string; fetched_at: string }
  >()
  for (const row of cachedRows ?? []) {
    cacheByTenant.set(row.tenant_id, {
      place_id: row.place_id,
      fetched_at: row.fetched_at,
    })
  }

  // Filter to tenants whose row is missing, place_id-mismatched, or stale.
  const cutoff = Date.now() - STALE_THRESHOLD_MS
  const stale: string[] = []
  for (const row of configuredRows) {
    const cached = cacheByTenant.get(row.tenant_id)
    if (!cached) {
      stale.push(row.tenant_id)
      continue
    }
    if (cached.place_id !== row.google_place_id) {
      // Operator changed the place_id; cached row is for the old one.
      stale.push(row.tenant_id)
      continue
    }
    const age = new Date(cached.fetched_at).getTime()
    if (Number.isNaN(age) || age < cutoff) {
      stale.push(row.tenant_id)
    }
  }

  if (stale.length === 0) {
    return NextResponse.json({
      ok: true,
      ran_at: ranAt,
      configured: configuredRows.length,
      stale: 0,
      refreshed: 0,
      failed: 0,
    })
  }

  // Refresh sequentially. Parallel would be faster but we don't want to
  // burst the Places API; the daily cadence makes serial fine. Each
  // refreshReviews() handles its own errors and never throws.
  const outcomes: RefreshOutcome[] = []
  for (const tenantId of stale) {
    try {
      const row = await refreshReviews(tenantId)
      // refreshReviews returns the row on success or the prior cached row
      // on error (with last_error set). We treat presence-without-error
      // as success and presence-with-error as failure.
      if (!row) {
        outcomes.push({ tenantId, status: 'failed', error: 'no_row' })
      } else if (row.last_error) {
        outcomes.push({ tenantId, status: 'failed', error: row.last_error })
      } else {
        outcomes.push({ tenantId, status: 'refreshed' })
      }
    } catch (err) {
      outcomes.push({
        tenantId,
        status: 'failed',
        error: err instanceof Error ? err.message : 'unknown',
      })
    }
  }

  const refreshed = outcomes.filter((o) => o.status === 'refreshed').length
  const failed = outcomes.filter((o) => o.status === 'failed').length

  // Audit-log per tenant. Matches release-buy-holds pattern: bypass
  // logAudit() since this is a system-cron action with no acting user.
  // Attribute to the tenant so per-tenant audit views see the entry.
  for (const outcome of outcomes) {
    const { error: auditError } = await admin.from('audit_log').insert({
      tenant_id: outcome.tenantId,
      user_id: null,
      action: 'google_reviews_refresh',
      table_name: 'tenant_google_reviews',
      record_id: null,
      changes: {
        status: outcome.status,
        error: outcome.error ?? null,
        ran_at: ranAt,
      },
    })
    if (auditError) {
      console.error(
        '[cron:refresh-google-reviews] audit insert failed',
        outcome.tenantId,
        auditError.message,
      )
    }
  }

  return NextResponse.json({
    ok: failed === 0,
    ran_at: ranAt,
    configured: configuredRows.length,
    stale: stale.length,
    refreshed,
    failed,
  })
}

function authorizeCron(req: NextRequest): boolean {
  const auth = req.headers.get('authorization')
  if (!auth) return false
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  return auth === `Bearer ${expected}`
}
