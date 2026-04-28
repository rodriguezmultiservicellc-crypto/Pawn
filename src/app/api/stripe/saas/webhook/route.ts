import { NextResponse, type NextRequest } from 'next/server'
import { verifyWebhookSignature } from '@/lib/stripe/saas'
import {
  handleInvoicePaid,
  handleInvoicePaymentFailed,
  handleSubscriptionDeleted,
  handleSubscriptionUpsert,
  handleTrialWillEnd,
  type StripeEvent,
  type StripeInvoice,
  type StripeSubscription,
} from '@/lib/saas/webhook-handlers'

/**
 * POST /api/stripe/saas/webhook
 *
 * Receives Stripe events for the SaaS-billing surface (RMS platform
 * account). NOT the per-tenant Connect webhook — that one lives at
 * /api/stripe/webhook for loan-payoff + layaway flows.
 *
 * Signing:
 *   Stripe signs the body with STRIPE_SAAS_WEBHOOK_SECRET. The signing
 *   secret is endpoint-specific — distinct from STRIPE_WEBHOOK_SECRET
 *   used by the Connect webhook.
 *
 * Idempotency:
 *   Stripe retries on non-2xx for up to 3 days. Our handlers are upserts
 *   keyed on stable IDs (tenant_id for subscriptions, stripe_invoice_id
 *   for invoices), so re-processing is safe.
 *
 * Event types handled:
 *   customer.subscription.created
 *   customer.subscription.updated
 *   customer.subscription.deleted
 *   customer.subscription.trial_will_end
 *   invoice.paid
 *   invoice.payment_failed
 *
 *   checkout.session.completed is intentionally a no-op — the
 *   subscription.created event that follows carries the full state.
 *
 * Runtime: Node — Web Crypto for HMAC verification works in Edge too,
 * but we read the body via req.text() which is fine in Node.
 */
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_SAAS_WEBHOOK_SECRET ?? ''
  const sigHeader = req.headers.get('stripe-signature')
  const payload = await req.text()

  // Signature verify. In dev mode without a secret set we fall through
  // (matches Connect webhook's policy at src/app/api/stripe/webhook).
  if (secret) {
    const verify = await verifyWebhookSignature({
      payload,
      signatureHeader: sigHeader,
      secret,
    })
    if (!verify.ok) {
      console.error('[saas-webhook] signature_invalid', verify.reason)
      return NextResponse.json(
        { error: `signature_invalid:${verify.reason}` },
        { status: 400 },
      )
    }
  } else if (process.env.NODE_ENV === 'production') {
    console.error('[saas-webhook] STRIPE_SAAS_WEBHOOK_SECRET missing in prod')
    return NextResponse.json({ error: 'webhook_unconfigured' }, { status: 500 })
  }

  let event: StripeEvent
  try {
    event = JSON.parse(payload) as StripeEvent
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 })
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as StripeSubscription
        const result = await handleSubscriptionUpsert(sub)
        return NextResponse.json({
          received: true,
          handled: result.ok,
          tenant_id: result.tenantId,
          reason: result.reason,
        })
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as StripeSubscription
        const result = await handleSubscriptionDeleted(sub)
        return NextResponse.json({
          received: true,
          handled: result.ok,
          tenant_id: result.tenantId,
          reason: result.reason,
        })
      }
      case 'customer.subscription.trial_will_end': {
        const sub = event.data.object as StripeSubscription
        const result = await handleTrialWillEnd(sub)
        return NextResponse.json({
          received: true,
          handled: result.ok,
          tenant_id: result.tenantId,
        })
      }
      case 'invoice.paid': {
        const invoice = event.data.object as StripeInvoice
        const result = await handleInvoicePaid(invoice)
        return NextResponse.json({
          received: true,
          handled: result.ok,
          tenant_id: result.tenantId,
          reason: result.reason,
        })
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object as StripeInvoice
        const result = await handleInvoicePaymentFailed(invoice)
        return NextResponse.json({
          received: true,
          handled: result.ok,
          tenant_id: result.tenantId,
          reason: result.reason,
        })
      }
      case 'checkout.session.completed':
        return NextResponse.json({ received: true, handled: false, skipped: true })
      default:
        return NextResponse.json({ received: true, ignored: true })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    console.error('[saas-webhook] handler_error', event.type, msg)
    // Return 500 so Stripe retries — only if the failure is transient.
    // Most of our handlers return non-throw errors via { ok: false }.
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
