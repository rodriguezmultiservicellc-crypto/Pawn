/**
 * Resend webhook receiver — bounce + complaint + delivery events for
 * campaign emails.
 *
 * Resend uses Svix to sign webhook payloads. Verification:
 *   1. Read `svix-id`, `svix-timestamp`, `svix-signature` headers.
 *   2. Compute HMAC-SHA256 of `${svix-id}.${svix-timestamp}.${body}`
 *      with the webhook secret (strip `whsec_` prefix + base64-decode).
 *   3. Compare against one of the space-separated `v1,<sig>` entries in
 *      the signature header. Constant-time compare.
 *
 * No external dependency — Node's `crypto` does HMAC + timing-safe
 * compare. We only handle the events we care about: delivered, bounced,
 * complained. Unknown event types are acknowledged (200) so Resend
 * doesn't retry, but no state changes.
 *
 * Idempotency: Svix retries until 2xx. Each event type's update is
 * idempotent — setting status to 'delivered' twice is harmless. For
 * bounce/complaint we additionally flip customers.marketing_opt_in=false
 * which is also idempotent.
 *
 * Configure: RESEND_WEBHOOK_SECRET env var (Resend dashboard → Webhooks).
 * The route URL is `${NEXT_PUBLIC_APP_URL}/api/webhooks/resend`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit'
import { recomputeAggregates } from '@/lib/email/campaigns'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type ResendEvent = {
  type: string
  created_at?: string
  data?: {
    email_id?: string
    to?: string[]
    from?: string
    bounce?: { type?: string; description?: string }
    [k: string]: unknown
  }
}

export async function POST(req: NextRequest) {
  const svixId = req.headers.get('svix-id')
  const svixTimestamp = req.headers.get('svix-timestamp')
  const svixSignature = req.headers.get('svix-signature')

  if (!svixId || !svixTimestamp || !svixSignature) {
    return new NextResponse('missing svix headers', { status: 400 })
  }

  const rawBody = await req.text()

  if (!verifySvixSignature(rawBody, svixId, svixTimestamp, svixSignature)) {
    return new NextResponse('signature verification failed', { status: 401 })
  }

  let event: ResendEvent
  try {
    event = JSON.parse(rawBody) as ResendEvent
  } catch {
    return new NextResponse('invalid json', { status: 400 })
  }

  const emailId = event.data?.email_id
  if (!emailId || typeof emailId !== 'string') {
    // Acknowledge — Resend has events without an email_id (account-level
    // notifications). Nothing to do; don't ask Resend to retry.
    return NextResponse.json({ ok: true, ignored: 'no_email_id' })
  }

  const admin = createAdminClient()

  // Find the recipient row this event refers to. Index on resend_message_id.
  const { data: recipient } = await admin
    .from('email_campaign_recipients')
    .select('id, campaign_id, customer_id, tenant_id, status')
    .eq('resend_message_id', emailId)
    .maybeSingle()

  if (!recipient) {
    // Email may have been a transactional reminder (not a campaign). Look
    // up in message_log instead — set delivered_at on the matching row.
    await applyTransactionalEvent(emailId, event)
    return NextResponse.json({ ok: true, scope: 'transactional' })
  }

  const nowIso = event.created_at ?? new Date().toISOString()

  switch (event.type) {
    case 'email.delivered':
      await admin
        .from('email_campaign_recipients')
        .update({ status: 'delivered', delivered_at: nowIso })
        .eq('id', recipient.id)
      // Mirror to message_log for the existing audit surface.
      await admin
        .from('message_log')
        .update({ status: 'delivered', delivered_at: nowIso })
        .eq('provider_id', emailId)
      await recomputeAggregates(recipient.campaign_id)
      break

    case 'email.bounced':
      await admin
        .from('email_campaign_recipients')
        .update({
          status: 'bounced',
          bounced_at: nowIso,
          bounce_reason:
            event.data?.bounce?.description ??
            event.data?.bounce?.type ??
            'unknown',
        })
        .eq('id', recipient.id)
      // Hard bounces flip the customer's marketing_opt_in — soft bounces
      // (transient delivery issues) do not. Default to flipping when the
      // bounce type is unknown, since Resend's classification is reliable
      // and protecting the platform's sender reputation outweighs an
      // edge-case false positive.
      if (
        event.data?.bounce?.type !== 'soft_bounce' &&
        event.data?.bounce?.type !== 'transient'
      ) {
        await admin
          .from('customers')
          .update({ marketing_opt_in: false })
          .eq('id', recipient.customer_id)
        await logAudit({
          tenantId: recipient.tenant_id,
          userId: null,
          action: 'email_campaign_bounce',
          tableName: 'customers',
          recordId: recipient.customer_id,
          changes: {
            via: 'resend_webhook',
            email_id: emailId,
            bounce_type: event.data?.bounce?.type ?? null,
            bounce_description: event.data?.bounce?.description ?? null,
          },
        })
      }
      await recomputeAggregates(recipient.campaign_id)
      break

    case 'email.complained':
      await admin
        .from('email_campaign_recipients')
        .update({ status: 'complained', complained_at: nowIso })
        .eq('id', recipient.id)
      // Spam complaints always flip marketing_opt_in. Continuing to
      // mail a complainant tanks platform sender reputation.
      await admin
        .from('customers')
        .update({ marketing_opt_in: false })
        .eq('id', recipient.customer_id)
      await logAudit({
        tenantId: recipient.tenant_id,
        userId: null,
        action: 'email_campaign_complaint',
        tableName: 'customers',
        recordId: recipient.customer_id,
        changes: {
          via: 'resend_webhook',
          email_id: emailId,
        },
      })
      await recomputeAggregates(recipient.campaign_id)
      break

    default:
      // Acknowledge other event types (sent, opened, clicked) without
      // state changes. Avoids a Resend retry loop.
      break
  }

  return NextResponse.json({ ok: true, type: event.type })
}

/**
 * Update message_log for transactional emails (loan reminders, layaway
 * notices, etc.) when the event isn't tied to a campaign recipient row.
 * Best-effort — message_log might not have the row yet if the cron is
 * still mid-write, in which case we silently skip.
 */
async function applyTransactionalEvent(emailId: string, event: ResendEvent): Promise<void> {
  if (event.type !== 'email.delivered') return
  const admin = createAdminClient()
  const nowIso = event.created_at ?? new Date().toISOString()
  await admin
    .from('message_log')
    .update({ status: 'delivered', delivered_at: nowIso })
    .eq('provider_id', emailId)
}

/**
 * Svix signature verification. Compares the request signature against
 * an HMAC of `${svix-id}.${svix-timestamp}.${body}` keyed on the
 * webhook secret.
 */
function verifySvixSignature(
  body: string,
  svixId: string,
  svixTimestamp: string,
  svixSignature: string,
): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) {
    console.error('[webhook:resend] RESEND_WEBHOOK_SECRET not set')
    return false
  }

  // Svix secrets are formatted as `whsec_<base64>`. Strip the prefix.
  const trimmed = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret
  let key: Buffer
  try {
    key = Buffer.from(trimmed, 'base64')
  } catch {
    return false
  }

  const signedPayload = `${svixId}.${svixTimestamp}.${body}`
  const expected = createHmac('sha256', key).update(signedPayload).digest()

  // Header is space-separated entries like "v1,<base64sig> v1,<base64sig>".
  // Match against any of them; Svix rotates so multiple may be active.
  const candidates = svixSignature.split(' ')
  for (const candidate of candidates) {
    const [version, sig] = candidate.split(',')
    if (version !== 'v1' || !sig) continue
    let provided: Buffer
    try {
      provided = Buffer.from(sig, 'base64')
    } catch {
      continue
    }
    if (provided.length !== expected.length) continue
    if (timingSafeEqual(provided, expected)) return true
  }
  return false
}
