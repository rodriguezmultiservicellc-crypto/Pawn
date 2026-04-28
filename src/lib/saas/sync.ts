import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import {
  createProduct,
  createRecurringPrice,
  deactivatePrice,
  listAllProducts,
  listPricesForProduct,
  updateProduct,
  type StripePrice,
  type StripeProduct,
} from '@/lib/stripe/saas'
import type { SubscriptionPlan } from './types'

export type SyncReport = {
  plans: Array<{
    code: string
    productId: string
    productAction: 'created' | 'updated' | 'unchanged'
    monthlyPriceId: string | null
    monthlyAction: 'created' | 'reused' | 'deactivated' | 'unchanged' | 'skipped'
    yearlyPriceId: string | null
    yearlyAction: 'created' | 'reused' | 'deactivated' | 'unchanged' | 'skipped'
  }>
}

/**
 * Idempotently mirror our subscription_plans into Stripe:
 *   1. For each plan, ensure a Stripe Product exists (matched by
 *      metadata.plan_code or by the saved stripe_product_id). Create or
 *      update name/description/metadata as needed.
 *   2. For each (product × cycle), ensure a Stripe Price exists at the
 *      configured cents amount. Stripe forbids editing a price's amount,
 *      so on a price change we deactivate the old one and create new.
 *   3. Write stripe_product_id / stripe_price_monthly_id /
 *      stripe_price_yearly_id back to subscription_plans.
 *
 * Called from the admin "Sync Stripe products" button at /admin/billing.
 * Safe to run repeatedly. Requires platform STRIPE_SECRET_KEY in env.
 */
export async function syncStripePlans(): Promise<SyncReport> {
  const admin = createAdminClient()

  const { data: plans, error: planErr } = await admin
    .from('subscription_plans')
    .select('*')
    .order('sort_order', { ascending: true })
  if (planErr) throw new Error(`load_plans_failed: ${planErr.message}`)
  if (!plans || plans.length === 0) {
    return { plans: [] }
  }

  // Pull all platform products once (idempotent matching key:
  // metadata.plan_code = 'basic' | 'pro' | 'chain'). We fall back to
  // stripe_product_id if it's already set on our row.
  const allProducts = await listAllProducts()
  const productByCode = new Map<string, StripeProduct>()
  for (const p of allProducts) {
    const code = p.metadata?.plan_code
    if (code) productByCode.set(code, p)
  }

  const out: SyncReport['plans'] = []

  for (const plan of plans as SubscriptionPlan[]) {
    // Resolve product (saved id wins, else metadata match, else create).
    const existing =
      (plan.stripe_product_id
        ? allProducts.find((p) => p.id === plan.stripe_product_id)
        : null) ??
      productByCode.get(plan.code) ??
      null

    let product: StripeProduct
    let productAction: 'created' | 'updated' | 'unchanged'
    if (existing) {
      const wantsUpdate =
        existing.name !== plan.name ||
        (existing.description ?? null) !== (plan.description ?? null) ||
        existing.metadata?.plan_code !== plan.code
      if (wantsUpdate) {
        product = await updateProduct(existing.id, {
          name: plan.name,
          description: plan.description ?? null,
          metadata: { plan_code: plan.code },
          active: plan.is_active,
        })
        productAction = 'updated'
      } else {
        product = existing
        productAction = 'unchanged'
      }
    } else {
      product = await createProduct({
        name: plan.name,
        description: plan.description ?? null,
        metadata: { plan_code: plan.code },
      })
      productAction = 'created'
    }

    // Prices for this product. We tag ours with metadata.cycle = monthly|yearly
    // so we can distinguish ours from any pre-existing or third-party prices.
    const prices = await listPricesForProduct(product.id)

    const monthly = await ensurePrice({
      product,
      prices,
      cycle: 'monthly',
      amountCents: plan.price_monthly_cents,
      planCode: plan.code,
      currentSavedId: plan.stripe_price_monthly_id,
    })

    const yearly = await ensurePrice({
      product,
      prices,
      cycle: 'yearly',
      amountCents: plan.price_yearly_cents,
      planCode: plan.code,
      currentSavedId: plan.stripe_price_yearly_id,
    })

    // Write back to our DB if anything changed.
    const wantPatch =
      product.id !== plan.stripe_product_id ||
      monthly.priceId !== plan.stripe_price_monthly_id ||
      yearly.priceId !== plan.stripe_price_yearly_id
    if (wantPatch) {
      const { error: upErr } = await admin
        .from('subscription_plans')
        .update({
          stripe_product_id: product.id,
          stripe_price_monthly_id: monthly.priceId,
          stripe_price_yearly_id: yearly.priceId,
        })
        .eq('id', plan.id)
      if (upErr) {
        throw new Error(`write_back_failed (${plan.code}): ${upErr.message}`)
      }
    }

    out.push({
      code: plan.code,
      productId: product.id,
      productAction,
      monthlyPriceId: monthly.priceId,
      monthlyAction: monthly.action,
      yearlyPriceId: yearly.priceId,
      yearlyAction: yearly.action,
    })
  }

  return { plans: out }
}

async function ensurePrice(args: {
  product: StripeProduct
  prices: StripePrice[]
  cycle: 'monthly' | 'yearly'
  amountCents: number | null
  planCode: string
  currentSavedId: string | null
}): Promise<{
  priceId: string | null
  action: 'created' | 'reused' | 'deactivated' | 'unchanged' | 'skipped'
}> {
  // A null/zero amount means "this plan has no price at this cycle"
  // (e.g. a plan that's monthly-only). If we've previously saved a price
  // id, deactivate it. Otherwise just skip.
  if (args.amountCents == null || args.amountCents <= 0) {
    if (args.currentSavedId) {
      await deactivatePrice(args.currentSavedId)
      return { priceId: null, action: 'deactivated' }
    }
    return { priceId: null, action: 'skipped' }
  }

  const interval: 'month' | 'year' = args.cycle === 'monthly' ? 'month' : 'year'

  // Try to reuse an existing matching price at the right amount.
  const candidate =
    args.prices.find(
      (p) =>
        p.active &&
        p.recurring?.interval === interval &&
        p.unit_amount === args.amountCents &&
        (p.metadata?.cycle === args.cycle || p.id === args.currentSavedId),
    ) ?? null

  if (candidate) {
    const action: 'reused' | 'unchanged' =
      candidate.id === args.currentSavedId ? 'unchanged' : 'reused'
    return { priceId: candidate.id, action }
  }

  // No active matching price. If the saved one exists with a different
  // amount, deactivate it (Stripe forbids editing amount on a Price).
  if (args.currentSavedId) {
    const stale = args.prices.find((p) => p.id === args.currentSavedId)
    if (stale && stale.active) {
      await deactivatePrice(stale.id)
    }
  }

  const created = await createRecurringPrice({
    productId: args.product.id,
    unitAmountCents: args.amountCents,
    interval,
    metadata: { plan_code: args.planCode, cycle: args.cycle },
  })
  return { priceId: created.id, action: 'created' }
}
