/**
 * Cron — release abandoned online checkouts (patches/0078).
 *
 * A piece is reserved (inventory_items.reserved_order_id) the moment a
 * shopper presses Pay. The Stripe "session expired" webhook normally gives
 * it back; this sweep is the safety net for a missed or delayed event.
 * online_order_sweep() releases every unpaid order more than 5 minutes past
 * its expiry, so a payment completing at the last second still finds it.
 *
 * Auth: Authorization: Bearer ${CRON_SECRET} (authorizeCron). Idempotent.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { authorizeCron } from '@/lib/cron/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) {
    return new NextResponse('unauthorized', { status: 401 })
  }
  const { data, error } = await createAdminClient().rpc('online_order_sweep')
  if (error) {
    console.error('[cron.release-online-orders]', error.message)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, released: data ?? 0 })
}
