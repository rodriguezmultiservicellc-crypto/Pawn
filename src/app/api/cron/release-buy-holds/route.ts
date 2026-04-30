/**
 * Cron — release expired buy-outright holds.
 *
 * Buy-outright items are inserted with `status='held'` and `hold_until` set
 * to today + tenants.settings.buy_hold_period_days (FL = 30). During the
 * hold window the item is NOT sellable. When `hold_until` passes the item
 * should flip to `status='available'`.
 *
 * Until this cron landed the flip required either a manual page action or
 * a sale attempt that re-checked the date. This route does the bulk flip
 * once a day.
 *
 * Selection criteria (all must hold):
 *   - status = 'held'
 *   - hold_until IS NOT NULL  ← excludes layaway holds (those use NULL)
 *   - hold_until <= today     ← regulatory window has elapsed
 *   - deleted_at IS NULL      ← skip soft-deleted rows
 *
 * The hold_until-NOT-NULL filter is load-bearing: layaway items also use
 * `status='held'` but with hold_until=NULL because those flip via the
 * layaway state machine (paid off / cancelled), not by date.
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}` only. Vercel Cron sets this
 *       header when CRON_SECRET is configured at the project level. The
 *       `x-vercel-cron` header is NOT a security check.
 *
 * Recommended cadence: once per day, well after midnight UTC so all US
 * timezones have crossed into the new day. The schedule is configured in
 * vercel.json.
 *
 * Idempotency: a second run finds zero matching rows because the first
 * run flipped them to 'available'. Safe to retry.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { todayDateString } from '@/lib/pawn/math'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type ReleasedRow = {
  id: string
  tenant_id: string
  sku: string | null
  hold_until: string | null
}

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) {
    return new NextResponse('unauthorized', { status: 401 })
  }

  const today = todayDateString()
  const admin = createAdminClient()

  const { data: rows, error: selectError } = await admin
    .from('inventory_items')
    .select('id, tenant_id, sku, hold_until')
    .eq('status', 'held')
    .not('hold_until', 'is', null)
    .lte('hold_until', today)
    .is('deleted_at', null)

  if (selectError) {
    return NextResponse.json(
      { ok: false, today, error: selectError.message },
      { status: 502 },
    )
  }

  const candidates = (rows ?? []) as ReleasedRow[]
  if (candidates.length === 0) {
    return NextResponse.json({ ok: true, today, released: 0, tenants: 0 })
  }

  const ids = candidates.map((r) => r.id)
  const { error: updateError } = await admin
    .from('inventory_items')
    .update({
      status: 'available',
      updated_at: new Date().toISOString(),
    })
    .in('id', ids)

  if (updateError) {
    return NextResponse.json(
      { ok: false, today, error: updateError.message },
      { status: 502 },
    )
  }

  // Audit-log one row per tenant, summarizing how many items flipped.
  // Bypass logAudit() since this is a system-cron action with no acting
  // user; we still attribute to the tenant so per-tenant audit views see
  // the entry.
  const byTenant = new Map<string, ReleasedRow[]>()
  for (const r of candidates) {
    const list = byTenant.get(r.tenant_id) ?? []
    list.push(r)
    byTenant.set(r.tenant_id, list)
  }

  for (const [tenantId, list] of byTenant.entries()) {
    const { error: auditError } = await admin.from('audit_log').insert({
      tenant_id: tenantId,
      user_id: null,
      action: 'inventory_hold_released',
      table_name: 'inventory_items',
      record_id: null,
      changes: {
        count: list.length,
        item_ids: list.map((r) => r.id),
        skus: list.map((r) => r.sku ?? null),
        hold_until_max: list.reduce<string | null>(
          (acc, r) => (acc == null || (r.hold_until ?? '') > acc ? r.hold_until : acc),
          null,
        ),
        ran_at: today,
      },
    })
    if (auditError) {
      console.error(
        '[cron:release-buy-holds] audit insert failed',
        tenantId,
        auditError.message,
      )
    }
  }

  return NextResponse.json({
    ok: true,
    today,
    released: candidates.length,
    tenants: byTenant.size,
  })
}

function authorizeCron(req: NextRequest): boolean {
  const auth = req.headers.get('authorization')
  if (!auth) return false
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  return auth === `Bearer ${expected}`
}
