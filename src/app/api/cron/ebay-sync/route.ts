/**
 * Cron — eBay listing sync.
 *
 * Recommended cadence: every 30 minutes during business hours (e.g. crontab
 *   `0,30 9-21 * * *` in UTC, or whatever maps to the operator's window).
 *   eBay's marketing-counter freshness is hours-grained anyway; sub-30m
 *   polling burns rate limit for no benefit.
 *
 * For each tenant that has connected eBay credentials:
 *   1. For every active listing, syncListing() (refreshes view + watcher
 *      counts) — STUBBED.
 *   2. Once at the end, fetchOrders() since the most recent
 *      last_synced_at across that tenant's listings — STUBBED, returns
 *      empty for now.
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}` only. Vercel Cron sets this
 *       header when CRON_SECRET is configured at the project level. The
 *       `x-vercel-cron` header is NOT a security check — any external HTTP
 *       caller can set it.
 *
 * STUB STAGE — every actual eBay round-trip is mocked. The control flow,
 * iteration shape, and DB updates are real.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchOrders, syncListing } from '@/lib/ebay/listings'
import type { EbayListingRow } from '@/types/database-aliases'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) {
    return new NextResponse('unauthorized', { status: 401 })
  }

  const admin = createAdminClient()
  const supa = admin

  // 1) Tenants with usable credentials. The refresh token lives in
  // tenant_secrets (vault); the credentials row carries the
  // disconnected_at marker. Intersect the two: tenant has a vault
  // refresh_token AND has not been disconnected.
  const [{ data: secretRows }, { data: credentialRows }] = await Promise.all([
    supa
      .from('tenant_secrets')
      .select('tenant_id')
      .eq('kind', 'ebay_refresh_token'),
    supa
      .from('tenant_ebay_credentials')
      .select('tenant_id, disconnected_at'),
  ])

  const disconnected = new Set(
    (credentialRows ?? [])
      .filter((r) => r.disconnected_at)
      .map((r) => r.tenant_id),
  )
  const tenantIds: string[] = (secretRows ?? [])
    .map((r) => r.tenant_id)
    .filter((tid): tid is string => typeof tid === 'string' && !disconnected.has(tid))

  let synced = 0
  let failed = 0
  let ordersFetched = 0

  for (const tenantId of tenantIds) {
    // 2) Active listings to refresh.
    const { data: listings } = (await supa
      .from('ebay_listings')
      .select('id, status, last_synced_at')
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .is('deleted_at', null)) as {
      data: Array<Pick<EbayListingRow, 'id' | 'status' | 'last_synced_at'>> | null
    }

    let earliestSynced: string | null = null
    for (const listing of listings ?? []) {
      try {
        await syncListing({ tenantId, listingId: listing.id })
        synced++
      } catch (err) {
        failed++
        console.error('[cron/ebay-sync] syncListing failed', {
          tenantId,
          listingId: listing.id,
          err,
        })
      }
      if (listing.last_synced_at) {
        if (!earliestSynced || listing.last_synced_at < earliestSynced) {
          earliestSynced = listing.last_synced_at
        }
      }
    }

    // 3) Fetch orders since the earliest known sync (24h fallback). STUB
    // currently returns empty.
    const sinceIso =
      earliestSynced ?? new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    try {
      const orders = await fetchOrders({ tenantId, sinceIso })
      ordersFetched += orders.length
      // TODO (real wire-up): for each order, look up ebay_listings by
      // ebay_listing_id (or ebay_sku), book a row in `sales` + `sale_items`,
      // mark the listing 'sold' and write sale_id back. The local POS
      // reporting + register flow then picks the eBay revenue up.
    } catch (err) {
      failed++
      console.error('[cron/ebay-sync] fetchOrders failed', { tenantId, err })
    }
  }

  return NextResponse.json({
    ok: true,
    tenants: tenantIds.length,
    synced,
    failed,
    ordersFetched,
  })
}

function authorizeCron(req: NextRequest): boolean {
  const auth = req.headers.get('authorization')
  if (!auth) return false
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  return auth === `Bearer ${expected}`
}
