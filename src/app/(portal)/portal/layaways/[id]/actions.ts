'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePortalCustomer } from '@/lib/portal/customer'
import { createCheckoutSession } from '@/lib/stripe/payment-link'
import { logAudit } from '@/lib/audit'
import { r4 } from '@/lib/pawn/math'
import { insertStripeLink } from '@/lib/portal/stripe-payment-links'
import type {
  LayawayRow,
  StripePaymentLinkInsert,
} from '@/types/database-aliases'
import type { LayawayPayActionResult } from './action-types'

/**
 * Create a Stripe Checkout Session for a layaway payment. The amount is
 * specified by the client (any amount up to the remaining balance — the
 * portal UI clamps to the balance).
 */
export async function createLayawayPaymentSession(args: {
  layawayId: string
  amount: number
}): Promise<LayawayPayActionResult> {
  let portal
  try {
    portal = await resolvePortalCustomer()
  } catch {
    return { ok: false, error: 'forbidden' }
  }

  const amount = r4(args.amount)
  if (!isFinite(amount) || amount < 1) {
    return { ok: false, error: 'amount_invalid' }
  }

  const admin = createAdminClient()

  const layawayLookup = await admin
    .from('layaways')
    .select(
      `id, tenant_id, customer_id, layaway_number, status, balance_remaining, deleted_at`,
    )
    .eq('id', args.layawayId)
    .maybeSingle()

  if (layawayLookup.error || !layawayLookup.data) {
    return { ok: false, error: 'not_found' }
  }
  const layaway = layawayLookup.data as unknown as LayawayRow

  if (layaway.deleted_at) return { ok: false, error: 'not_found' }
  if (layaway.tenant_id !== portal.tenantId) {
    return { ok: false, error: 'forbidden' }
  }
  if (layaway.customer_id !== portal.customerId) {
    return { ok: false, error: 'forbidden' }
  }
  if (
    layaway.status === 'completed' ||
    layaway.status === 'cancelled'
  ) {
    return { ok: false, error: 'closed' }
  }

  const balance = Number(layaway.balance_remaining ?? 0)
  if (balance <= 0) return { ok: false, error: 'closed' }

  const capped = Math.min(amount, r4(balance))

  let session
  try {
    session = await createCheckoutSession({
      tenantId: portal.tenantId,
      kind: 'layaway_payment',
      sourceId: layaway.id,
      customerId: portal.customerId,
      amount: capped,
      description: `Layaway ${layaway.layaway_number ?? ''} payment`.trim(),
      returnPath: `/portal/layaways/${layaway.id}`,
      customerEmail: portal.customerEmail,
      metadata: {
        layaway_number: layaway.layaway_number ?? '',
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'stripe_failed'
    if (msg === 'tenant_stripe_not_connected') {
      return { ok: false, error: 'no_stripe' }
    }
    return { ok: false, error: 'stripe_failed' }
  }

  if (!session.url || !session.id) {
    return { ok: false, error: 'stripe_failed' }
  }

  const insert: StripePaymentLinkInsert = {
    tenant_id: portal.tenantId,
    source_kind: 'layaway_payment',
    source_id: layaway.id,
    customer_id: portal.customerId,
    stripe_session_id: session.id,
    checkout_url: session.url,
    amount: capped.toFixed(4),
    status: 'pending',
  }

  const linkRow = await insertStripeLink(insert)

  if (!linkRow) {
    console.error('[portal] stripe_payment_links insert failed for', session.id)
  } else {
    await logAudit({
      tenantId: portal.tenantId,
      userId: portal.userId,
      action: 'create',
      tableName: 'stripe_payment_links',
      recordId: linkRow.id,
      changes: {
        source_kind: 'layaway_payment',
        source_id: layaway.id,
        amount: capped,
      },
    })
  }

  return { ok: true, checkoutUrl: session.url }
}
