/**
 * orocut.com webhook — status changes for laser nameplate orders
 * (patches/0070). Body: {order_id, external_id, status, reason?, details?,
 * at}; header `X-OroCut-Signature: sha256=<hex HMAC-SHA256(body, secret)>`
 * where the secret is the `whsec_…` webhook signing secret issued beside
 * the order token at orocut.com/account (vault kind 'orocut_webhook_secret').
 *
 * The tenant is resolved FROM the order id (orocut.com ids are global and
 * `laser_orders.orocut_order_id` is unique), then the signature is checked
 * against that tenant's webhook secret from the vault. Unknown order → 404 so
 * orocut.com retries (covers the tiny window between its POST answer and
 * our insert). Bad signature → 401. Everything else → 200 even when the
 * event changed nothing (retries, stale deliveries) so it stops resending.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getTenantSecret } from '@/lib/secrets/vault'
import { verifyOrocutSignature } from '@/lib/orocut/signature'
import { applyRemoteStatus, LASER_ORDER_SYNC_COLUMNS, type LaserOrderSyncRow } from '@/lib/orocut/sync'
import { parseCutDetails } from '@/lib/orocut/merge'
import { orocutWebhookSchema } from '@/lib/validations/laser-order'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  let json: unknown
  try {
    json = JSON.parse(rawBody)
  } catch {
    return new NextResponse('invalid json', { status: 400 })
  }
  const parsed = orocutWebhookSchema.safeParse(json)
  if (!parsed.success) {
    return new NextResponse('invalid body', { status: 400 })
  }
  const ev = parsed.data

  const admin = createAdminClient()
  const { data: row } = await admin
    .from('laser_orders')
    .select(LASER_ORDER_SYNC_COLUMNS)
    .eq('orocut_order_id', ev.order_id)
    .is('deleted_at', null)
    .maybeSingle()
  if (!row) return new NextResponse('unknown order', { status: 404 })

  const secret = await getTenantSecret(row.tenant_id, 'orocut_webhook_secret')
  if (!secret || !verifyOrocutSignature(rawBody, req.headers.get('x-orocut-signature'), secret)) {
    return new NextResponse('signature verification failed', { status: 401 })
  }

  const res = await applyRemoteStatus(
    admin,
    row as LaserOrderSyncRow,
    {
      status: ev.status,
      at: ev.at,
      by: ev.by ?? null,
      reason: ev.reason ?? null,
      details: parseCutDetails(ev.details),
    },
    'webhook',
    null,
  )
  if (!res.ok) {
    console.error('[webhook:orocut] apply failed', ev.order_id, res.error)
    return new NextResponse('apply failed', { status: 500 })
  }
  return NextResponse.json({ ok: true, changed: res.changed, status: res.status })
}
