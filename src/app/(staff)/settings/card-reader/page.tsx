import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { loadShopReader } from '@/lib/pos/reader-server'
import { getTerminalReader, stripeTestMode, tenantHasStripeAccount } from '@/lib/stripe/terminal'
import CardReaderContent, { type CardReaderView } from './content'

export const dynamic = 'force-dynamic'

const VIEW_ROLES = ['owner', 'chain_admin', 'manager'] as const
const EDIT_ROLES = ['owner', 'chain_admin'] as const

/** /settings/card-reader — the shop's Stripe Terminal reader (patches/0086). */
export default async function CardReaderSettingsPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  if (!ctx.tenantRole || !(VIEW_ROLES as readonly string[]).includes(ctx.tenantRole)) redirect('/settings')

  const stripeConfigured = !!process.env.STRIPE_SECRET_KEY
  const connected = stripeConfigured && (await tenantHasStripeAccount(ctx.tenantId))
  const reader = await loadShopReader(ctx.tenantId)

  // Live status from Stripe — advisory; the page still renders without it.
  let live: CardReaderView['live'] = null
  if (reader && connected) {
    try {
      const r = await getTerminalReader({ tenantId: ctx.tenantId, readerId: reader.readerId })
      live = { status: r.status, deviceType: r.device_type, serial: r.serial_number }
    } catch {
      live = null
    }
  }

  const view: CardReaderView = {
    canEdit: (EDIT_ROLES as readonly string[]).includes(ctx.tenantRole),
    stripeConfigured,
    connected,
    testMode: stripeTestMode(),
    reader: reader ? { id: reader.readerId, label: reader.label } : null,
    live,
  }
  return <CardReaderContent view={view} />
}
