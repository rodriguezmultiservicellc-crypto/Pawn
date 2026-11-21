import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { createAdminClient } from '@/lib/supabase/admin'
import { getTenantSecret } from '@/lib/secrets/vault'
import { loadShopReader } from '@/lib/pos/reader-server'
import {
  getTerminalReader,
  stripeAccountInfo,
  tenantStripeReady,
  tenantStripeTestMode,
  type StripeChargeMode,
} from '@/lib/stripe/terminal'
import CardReaderContent, { type CardReaderView } from './content'

export const dynamic = 'force-dynamic'

const VIEW_ROLES = ['owner', 'chain_admin', 'manager'] as const
const EDIT_ROLES = ['owner', 'chain_admin'] as const

/** /settings/card-reader — the shop's Stripe account + Terminal reader (0086, 0087). */
export default async function CardReaderSettingsPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  const isSuperadmin = ctx.globalRole === 'superadmin'
  if (!isSuperadmin && (!ctx.tenantRole || !(VIEW_ROLES as readonly string[]).includes(ctx.tenantRole))) {
    redirect('/settings')
  }
  const tenantId = ctx.tenantId

  const { data: s } = await createAdminClient()
    .from('settings')
    .select('stripe_charge_mode')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  const mode = (s?.stripe_charge_mode ?? 'connect') as StripeChargeMode

  const [ready, testMode, account, reader, ownKeySaved] = await Promise.all([
    tenantStripeReady(tenantId),
    tenantStripeTestMode(tenantId),
    stripeAccountInfo(tenantId),
    loadShopReader(tenantId),
    getTenantSecret(tenantId, 'stripe_own_secret_key').then((k) => !!k),
  ])

  // Live reader status from Stripe — advisory; the page renders without it.
  let live: CardReaderView['live'] = null
  if (reader && ready) {
    try {
      const r = await getTerminalReader({ tenantId, readerId: reader.readerId })
      live = { status: r.status, deviceType: r.device_type, serial: r.serial_number }
    } catch {
      live = null
    }
  }

  const view: CardReaderView = {
    canEdit: isSuperadmin || (!!ctx.tenantRole && (EDIT_ROLES as readonly string[]).includes(ctx.tenantRole)),
    isSuperadmin,
    platformKeySet: !!process.env.STRIPE_SECRET_KEY,
    mode,
    ownKeySaved,
    ready,
    testMode,
    account,
    reader: reader ? { id: reader.readerId, label: reader.label } : null,
    live,
  }
  return <CardReaderContent view={view} />
}
