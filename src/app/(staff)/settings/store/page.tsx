import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { isTenantStripeConnected } from '@/lib/stripe/payment-link'
import StoreSettingsContent from './content'
import type { StoreSettingsInput } from '@/lib/store/settings'

export const dynamic = 'force-dynamic'

const VIEW = new Set(['owner', 'chain_admin', 'manager'])
const EDIT = new Set(['owner', 'chain_admin'])

/** /settings/store — online checkout, delivery, tax, card limit, policies, branding. */
export default async function StoreSettingsPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  if (!ctx.tenantRole || !VIEW.has(ctx.tenantRole)) redirect('/dashboard')

  const [{ data: s }, { data: t }, stripe] = await Promise.all([
    ctx.supabase
      .from('settings')
      .select(
        'online_checkout_enabled, default_tax_rate, online_pickup_enabled, online_ship_enabled, ship_flat_rate, ship_free_over, ship_signature_over, online_order_max, online_reservation_minutes, store_return_policy_en, store_return_policy_es, store_shipping_policy_en, store_shipping_policy_es, store_tagline_en, store_tagline_es, store_accent_color',
      )
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle(),
    ctx.supabase
      .from('tenants')
      .select('public_landing_enabled, public_catalog_enabled, public_slug, has_retail, custom_domain, custom_domain_token, custom_domain_verified_at')
      .eq('id', ctx.tenantId)
      .maybeSingle(),
    isTenantStripeConnected(ctx.tenantId),
  ])

  const initial: StoreSettingsInput = {
    online_checkout_enabled: s?.online_checkout_enabled ?? false,
    tax_rate_pct: Math.round(Number(s?.default_tax_rate ?? 0) * 10000) / 100,
    online_pickup_enabled: s?.online_pickup_enabled ?? true,
    online_ship_enabled: s?.online_ship_enabled ?? false,
    ship_flat_rate: Number(s?.ship_flat_rate ?? 0),
    ship_free_over: s?.ship_free_over == null ? '' : Number(s.ship_free_over),
    ship_signature_over: s?.ship_signature_over == null ? '' : Number(s.ship_signature_over),
    online_order_max: Number(s?.online_order_max ?? 2500),
    online_reservation_minutes: s?.online_reservation_minutes ?? 30,
    store_return_policy_en: s?.store_return_policy_en ?? '',
    store_return_policy_es: s?.store_return_policy_es ?? '',
    store_shipping_policy_en: s?.store_shipping_policy_en ?? '',
    store_shipping_policy_es: s?.store_shipping_policy_es ?? '',
    store_tagline_en: s?.store_tagline_en ?? '',
    store_tagline_es: s?.store_tagline_es ?? '',
    store_accent_color: s?.store_accent_color ?? '',
  }

  return (
    <StoreSettingsContent
      initial={initial}
      canEdit={EDIT.has(ctx.tenantRole)}
      catalogLive={!!(t?.public_landing_enabled && t.public_catalog_enabled && t.public_slug && t.has_retail)}
      stripeConnected={stripe}
      storeUrl={t?.public_slug ? `/s/${t.public_slug}/catalog` : null}
      domain={{
        domain: t?.custom_domain ?? null,
        // The token is only for the owner to paste into DNS.
        token: EDIT.has(ctx.tenantRole) ? (t?.custom_domain_token ?? null) : null,
        verified: !!t?.custom_domain_verified_at,
      }}
    />
  )
}
