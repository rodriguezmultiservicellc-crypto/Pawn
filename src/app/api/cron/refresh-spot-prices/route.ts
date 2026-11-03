/**
 * Cron — refresh bullion spot prices.
 *
 * Calls `refreshSpotPrices()` (provider chain → per-purity expansion →
 * insert into `spot_prices`; writes its own `spot_price_fetches` row) and
 * mirrors the run summary into `audit_log` as `spot_price_refresh`.
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}` only. Vercel Cron sets this
 *       header when CRON_SECRET is configured at the project level. The
 *       `x-vercel-cron` header is NOT a security check — any external HTTP
 *       caller can set it.
 *
 *       A MISSING secret is logged loudly: this route silently 401'd for
 *       six months in 2026 because CRON_SECRET was never set in Production,
 *       and nothing downstream could record a run that never started.
 *
 * Cadence lives in `vercel.json`:
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

  const summary = await refreshSpotPrices({ trigger: 'cron' })
  // Bust the per-key 5-minute cache so subsequent reads see the new rows
  // immediately (without waiting for the TTL).
  clearSpotPriceCache()

  await logCronAudit(summary)

  const status = summary.ok ? 200 : 502
  return NextResponse.json(summary, { status })
}

function authorizeCron(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    console.error(
      '[cron:spot-prices] CRON_SECRET is not set — every scheduled run is rejected with 401 and spot prices will go stale. Set it in the Vercel project environment.',
    )
    return false
  }
  const auth = req.headers.get('authorization')
  if (!auth) return false
  return auth === `Bearer ${expected}`
}

/**
 * Mirror the run into audit_log. spot prices are platform-wide data and
 * no tenant owns them, so we bypass `logAudit()`'s tenant_id requirement
 * and write directly via the admin client with tenant_id NULL.
 */
async function logCronAudit(summary: RefreshSummary): Promise<void> {
  try {
    const admin = createAdminClient()
    const { error } = await admin.from('audit_log').insert({
      tenant_id: null,
      user_id: null,
      action: 'spot_price_refresh',
      table_name: 'spot_prices',
      record_id: summary.fetchLogId,
      changes: {
        ok: summary.ok,
        source: summary.source,
        quotes: summary.quotes,
        attempted: summary.attempted,
        inserted: summary.inserted,
        error: summary.error ?? null,
        attempts: summary.attempts,
      },
    })
    if (error) console.error('[cron:spot-prices] audit insert failed', error.message)
  } catch (err) {
    console.error('[cron:spot-prices] audit unexpected error', err)
  }
}
