/**
 * Cron — poll orocut.com for open laser nameplate orders (patches/0070).
 *
 * The webhook is the fast path; this catches a missed delivery and keeps a
 * ticket nobody has open from going stale. Only OPEN orders (new / received
 * / cut) whose last check is older than STALE_MS are touched, oldest first,
 * capped per run. One token lookup per tenant.
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}` (same as every other cron).
 * Schedule: every 5 minutes (vercel.json). A dead orocut.com writes
 * `last_sync_error` on each row and the run still returns 200.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getTenantSecret } from '@/lib/secrets/vault'
import { OPEN_LASER_STATUSES } from '@/lib/orocut/status'
import { LASER_ORDER_SYNC_COLUMNS, syncLaserOrder, type LaserOrderSyncRow } from '@/lib/orocut/sync'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STALE_MS = 4 * 60 * 1000
const MAX_PER_RUN = 100

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) {
    return new NextResponse('unauthorized', { status: 401 })
  }
  const ranAt = new Date().toISOString()
  const cutoff = new Date(Date.now() - STALE_MS).toISOString()
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('laser_orders')
    .select(`${LASER_ORDER_SYNC_COLUMNS}, last_synced_at`)
    .in('status', [...OPEN_LASER_STATUSES])
    .is('deleted_at', null)
    .or(`last_synced_at.is.null,last_synced_at.lt.${cutoff}`)
    .order('last_synced_at', { ascending: true, nullsFirst: true })
    .limit(MAX_PER_RUN)
  if (error) {
    return NextResponse.json({ ok: false, ran_at: ranAt, error: error.message }, { status: 502 })
  }

  const rows = (data ?? []) as Array<LaserOrderSyncRow & { last_synced_at: string | null }>
  const tokens = new Map<string, string | null>()
  let changed = 0
  let failed = 0
  for (const row of rows) {
    if (!tokens.has(row.tenant_id)) {
      tokens.set(row.tenant_id, await getTenantSecret(row.tenant_id, 'orocut_order_token'))
    }
    const res = await syncLaserOrder(admin, row, tokens.get(row.tenant_id))
    if (!res.ok) failed += 1
    else if (res.changed) changed += 1
  }

  return NextResponse.json({
    ok: true,
    ran_at: ranAt,
    checked: rows.length,
    changed,
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
