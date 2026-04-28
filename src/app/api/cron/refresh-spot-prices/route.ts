/**
 * Cron — refresh bullion spot prices.
 *
 * Calls `refreshSpotPrices()` (which fetches metals.live, expands per
 * purity, and inserts into `spot_prices`). Records a `spot_price_refresh`
 * row in `audit_log` with the run summary.
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}` only. Vercel Cron sets this
 *       header when CRON_SECRET is configured at the project level. The
 *       `x-vercel-cron` header is NOT a security check — any external HTTP
 *       caller can set it.
 *
 * Recommended cadence (configure in `vercel.json` at deploy time):
 *   - Every 15 min during US bullion market hours (Mon–Fri 08:00–17:00 ET)
 *     -> `*\/15 13-21 * * 1-5` (UTC, accounting for ET ≈ UTC-5/-4)
 *   - Every 60 min during off-hours and weekends
 *     -> `0 * * * *` as a fallback
 *
 * Idempotency: spot_prices.UNIQUE(metal_type, purity, fetched_at) +
 * upsert(ignoreDuplicates: true) make this safe to retry.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit'
import {
  refreshSpotPrices,
  type RefreshSummary,
} from '@/lib/spot-prices/refresh'
import { clearSpotPriceCache } from '@/lib/spot-prices/lookup'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) {
    return new NextResponse('unauthorized', { status: 401 })
  }

  const summary = await refreshSpotPrices()
  // Bust the per-key 5-minute cache so subsequent reads see the new rows
  // immediately (without waiting for the TTL).
  clearSpotPriceCache()

  // Audit-log the run. spot_price_refresh is platform-wide (not
  // tenant-scoped), so we log it against the system tenant id (NULL)
  // — audit_log allows NULL tenant_id at the column level. The cron
  // also has no acting user; we synthesize the system-cron sentinel.
  await logCronAudit(summary)

  const status = summary.ok ? 200 : 502
  return NextResponse.json(summary, { status })
}

function authorizeCron(req: NextRequest): boolean {
  const auth = req.headers.get('authorization')
  if (!auth) return false
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  return auth === `Bearer ${expected}`
}

/**
 * Audit-log the cron run. We bypass `logAudit()`'s tenant_id requirement
 * by writing directly via the admin client — spot prices are platform-wide
 * data and no tenant owns them. The audit_log row has tenant_id NULL.
 */
async function logCronAudit(summary: RefreshSummary): Promise<void> {
  try {
    const admin = createAdminClient()
    const { error } = await admin.from('audit_log').insert({
      tenant_id: null,
      user_id: null,
      action: 'spot_price_refresh',
      table_name: 'spot_prices',
      // record_id is required by the column shape but the schema allows NULL;
      // we leave it null since this is a multi-row insert summary, not a
      // single record.
      record_id: null,
      changes: {
        ok: summary.ok,
        source: summary.source,
        quotes: summary.quotes,
        attempted: summary.attempted,
        inserted: summary.inserted,
        error: summary.error ?? null,
      },
    })
    if (error) console.error('[cron:spot-prices] audit insert failed', error.message)
  } catch (err) {
    console.error('[cron:spot-prices] audit unexpected error', err)
  }
  // Also stamp through logAudit() so the fully-shaped action union stays
  // canonical — but only when we have a tenant id, which we don't.
  // (Kept commented for documentation.)
  // await logAudit({ tenantId, userId, action: 'spot_price_refresh', ... })
  void logAudit
}
