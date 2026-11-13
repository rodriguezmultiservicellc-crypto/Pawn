/**
 * Online orders (patches/0078, PLAN-2026-11-13 Phase 3) — server side.
 *
 * The database does the money and stock work (reserve, release, paid,
 * advance). This file is the glue: it calls those functions with the
 * service role, creates the Stripe Checkout session on the shop's connected
 * account, and sends the customer messages.
 *
 * Trust: an online order is matched to a Stripe event by OUR row only
 * (stripe_session_id written when the session was created), the event's
 * account must be the shop's connected account, and the amount must equal
 * the order total in cents (checked inside online_order_paid).
 */

import 'server-only'
import { randomBytes } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { stripeFetch } from '@/lib/stripe/http'
import { getStripeAccountIdForTenant, type CheckoutSession } from '@/lib/stripe/payment-link'
import { dispatchMessage } from '@/lib/comms/dispatch'
import { formatMoney } from '@/lib/format/money'
import type { Database } from '@/types/database'

type Fns = Database['public']['Functions']

export const ORDER_ERRORS = [
  'checkout_off',
  'too_many_items',
  'item_unavailable',
  'fulfillment_off',
  'order_over_limit',
  'cannot_checkout',
  'too_many_pending',
  'stripe_not_connected',
] as const
export type OrderError = (typeof ORDER_ERRORS)[number] | 'generic'

export function orderError(message: string | null | undefined): OrderError {
  const m = message ?? ''
  if (m.includes('tenant_stripe_not_connected')) return 'stripe_not_connected'
  return ORDER_ERRORS.find((t) => m.includes(t)) ?? 'generic'
}

export type CheckoutInput = {
  tenantId: string
  slug: string
  itemIds: string[]
  name: string
  email: string
  phone: string | null
  language: 'en' | 'es'
  fulfillment: 'pickup' | 'ship'
  address: { line1: string; line2: string | null; city: string; state: string; postal: string } | null
}

function appBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3060'
  return raw.replace(/\/+$/, '')
}

export function orderStatusPath(slug: string, token: string): string {
  return `/s/${slug}/order/${token}`
}

/**
 * Reserve the pieces, open a Stripe Checkout session for the exact total,
 * and return its URL. If Stripe fails, the reservation is released at once.
 */
export async function startCheckout(input: CheckoutInput): Promise<{ ok: true; url: string } | { ok: false; error: OrderError }> {
  const admin = createAdminClient()
  const token = randomBytes(32).toString('base64url')

  // Fail before reserving if the shop cannot take cards.
  let accountId: string
  try {
    accountId = await getStripeAccountIdForTenant(input.tenantId)
  } catch {
    return { ok: false, error: 'stripe_not_connected' }
  }

  const reserveArgs = {
    p_tenant_id: input.tenantId,
    p_item_ids: input.itemIds,
    p_token: token,
    p_name: input.name,
    p_email: input.email,
    p_phone: input.phone,
    p_language: input.language,
    p_fulfillment: input.fulfillment,
    p_ship_line1: input.address?.line1 ?? null,
    p_ship_line2: input.address?.line2 ?? null,
    p_ship_city: input.address?.city ?? null,
    p_ship_state: input.address?.state ?? null,
    p_ship_postal: input.address?.postal ?? null,
  } as unknown as Fns['online_order_reserve']['Args']
  const { data: reserved, error: reserveErr } = await admin.rpc('online_order_reserve', reserveArgs)
  const order = reserved?.[0]
  if (reserveErr || !order) {
    if (reserveErr) console.warn('[store.checkout] reserve refused', reserveErr.message)
    return { ok: false, error: orderError(reserveErr?.message) }
  }

  try {
    const [{ data: row }, { data: lines }] = await Promise.all([
      admin.from('online_orders').select('order_number, tax_amount, shipping_amount, contact_email, language')
        .eq('id', order.o_order_id).single(),
      admin.from('online_order_items').select('sku, description, unit_price')
        .eq('order_id', order.o_order_id).order('position'),
    ])
    if (!row) throw new Error('order_row_missing')

    const base = appBaseUrl()
    const statusPath = orderStatusPath(input.slug, token)
    // Stripe needs ≥ 30 minutes; the sweep gives the order 5 more minutes of
    // grace, so a payment completed at the last second still finds it.
    const expiresAt = Math.max(
      Math.floor(new Date(order.o_expires_at).getTime() / 1000),
      Math.floor(Date.now() / 1000) + 30 * 60 + 30,
    )

    const body: Record<string, string | number> = {
      mode: 'payment',
      'payment_method_types[0]': 'card',
      success_url: `${base}${statusPath}?paid=1`,
      cancel_url: `${base}${statusPath}?cancelled=1`,
      client_reference_id: order.o_order_id,
      customer_email: row.contact_email,
      locale: row.language === 'es' ? 'es' : 'en',
      expires_at: expiresAt,
      'metadata[tenant_id]': input.tenantId,
      'metadata[kind]': 'online_order',
      'metadata[order_id]': order.o_order_id,
      'payment_intent_data[description]': `Online order ${row.order_number}`,
    }
    let i = 0
    const addLine = (name: string, amount: number) => {
      body[`line_items[${i}][price_data][currency]`] = 'usd'
      body[`line_items[${i}][price_data][unit_amount]`] = Math.round(amount * 100)
      body[`line_items[${i}][price_data][product_data][name]`] = name.slice(0, 250)
      body[`line_items[${i}][quantity]`] = 1
      i++
    }
    for (const l of lines ?? []) addLine(`${l.description} (${l.sku})`, Number(l.unit_price))
    if (Number(row.shipping_amount) > 0) addLine(row.language === 'es' ? 'Envío' : 'Shipping', Number(row.shipping_amount))
    if (Number(row.tax_amount) > 0) addLine(row.language === 'es' ? 'Impuesto de venta' : 'Sales tax', Number(row.tax_amount))

    const session = await stripeFetch<CheckoutSession>('/checkout/sessions', {
      method: 'POST',
      body,
      accountId,
      idempotencyKey: `online-order-${order.o_order_id}`,
    })
    if (!session.url) throw new Error('stripe_no_url')
    // Stripe's total must be the order's total to the cent.
    if (session.amount_total !== Math.round(Number(order.o_total) * 100)) throw new Error('stripe_amount_mismatch')

    const attachArgs = {
      p_tenant_id: input.tenantId,
      p_order_id: order.o_order_id,
      p_session_id: session.id,
      p_account_id: accountId,
    } as unknown as Fns['online_order_attach_session']['Args']
    const { error: attachErr } = await admin.rpc('online_order_attach_session', attachArgs)
    if (attachErr) throw new Error(attachErr.message)
    return { ok: true, url: session.url }
  } catch (err) {
    console.error('[store.checkout] session failed; releasing', err)
    await releaseOrder(input.tenantId, order.o_order_id, 'cancelled')
    return { ok: false, error: 'generic' }
  }
}

export async function releaseOrder(tenantId: string, orderId: string, reason: 'expired' | 'cancelled'): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc('online_order_release', {
    p_tenant_id: tenantId,
    p_order_id: orderId,
    p_reason: reason,
  })
  if (error) console.error('[store.release]', error.message)
  return data === true
}

export type PublicOrder = {
  id: string
  tenantId: string
  orderNumber: string
  status: string
  fulfillment: 'pickup' | 'ship'
  contactName: string
  language: 'en' | 'es'
  subtotal: number
  taxAmount: number
  shippingAmount: number
  total: number
  expiresAt: string
  paidAt: string | null
  readyAt: string | null
  shippedAt: string | null
  completedAt: string | null
  carrier: string | null
  trackingNumber: string | null
  items: Array<{ sku: string; description: string; unitPrice: number }>
}

/** The shopper's view of an order, by its unguessable token. Never staff fields. */
export async function loadOrderByToken(tenantId: string, token: string): Promise<PublicOrder | null> {
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) return null
  const admin = createAdminClient()
  const { data: o } = await admin
    .from('online_orders')
    .select('id, tenant_id, order_number, status, fulfillment, contact_name, language, subtotal, tax_amount, shipping_amount, total, expires_at, paid_at, ready_at, shipped_at, completed_at, carrier, tracking_number')
    .eq('tenant_id', tenantId)
    .eq('public_token', token)
    .maybeSingle()
  if (!o) return null
  const { data: items } = await admin
    .from('online_order_items')
    .select('sku, description, unit_price')
    .eq('order_id', o.id)
    .order('position')
  return {
    id: o.id,
    tenantId: o.tenant_id,
    orderNumber: o.order_number,
    status: o.status,
    fulfillment: o.fulfillment as 'pickup' | 'ship',
    contactName: o.contact_name,
    language: o.language === 'es' ? 'es' : 'en',
    subtotal: Number(o.subtotal),
    taxAmount: Number(o.tax_amount),
    shippingAmount: Number(o.shipping_amount),
    total: Number(o.total),
    expiresAt: o.expires_at,
    paidAt: o.paid_at,
    readyAt: o.ready_at,
    shippedAt: o.shipped_at,
    completedAt: o.completed_at,
    carrier: o.carrier,
    trackingNumber: o.tracking_number,
    items: (items ?? []).map((i) => ({ sku: i.sku, description: i.description, unitPrice: Number(i.unit_price) })),
  }
}

/** Cancel an unpaid order from the shopper's own page (Stripe "back" button). */
export async function cancelPendingByToken(tenantId: string, token: string): Promise<void> {
  const order = await loadOrderByToken(tenantId, token)
  if (order && order.status === 'pending_payment') await releaseOrder(tenantId, order.id, 'cancelled')
}

type OrderMessageKind = 'online_order_confirmed' | 'online_order_ready' | 'online_order_shipped'

/** Bilingual customer message for an order (customer's language and channel). */
export async function sendOrderMessage(args: { tenantId: string; orderId: string; kind: OrderMessageKind }): Promise<void> {
  const admin = createAdminClient()
  const { data: o } = await admin
    .from('online_orders')
    .select('order_number, customer_id, total, public_token, fulfillment, language, carrier, tracking_number, tenant_id')
    .eq('id', args.orderId)
    .eq('tenant_id', args.tenantId)
    .maybeSingle()
  if (!o?.customer_id) return
  const { data: t } = await admin.from('tenants').select('public_slug').eq('id', args.tenantId).maybeSingle()
  const link = t?.public_slug ? `${appBaseUrl()}${orderStatusPath(t.public_slug, o.public_token)}` : ''
  const es = o.language === 'es'
  try {
    await dispatchMessage({
      tenantId: args.tenantId,
      customerId: o.customer_id,
      kind: args.kind,
      vars: {
        order_number: o.order_number,
        amount: formatMoney(Number(o.total)),
        order_link: link,
        carrier: o.carrier ?? '',
        tracking_number: o.tracking_number ?? '',
        fulfillment_next:
          o.fulfillment === 'ship'
            ? es ? 'enviado' : 'shipped'
            : es ? 'listo para recoger' : 'ready for pickup',
      },
    })
  } catch (err) {
    // A message failure never undoes an order; message_log records it.
    console.error('[store.message]', args.kind, err)
  }
}
