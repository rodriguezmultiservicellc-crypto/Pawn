'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CheckCircle, Clock, Package, Truck, Warning } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { formatMoney } from '@/lib/format/money'
import type { PublicTenant } from '@/lib/tenant-resolver'
import type { PublicOrder } from '@/lib/store/orders'
import { clearCart } from '@/components/store/cart'
import { StoreFooter, StoreHeader } from '@/components/store/StoreChrome'

export default function OrderStatusContent({
  tenant,
  order,
  justPaid,
}: {
  tenant: PublicTenant
  order: PublicOrder
  justPaid: boolean
}) {
  const { t } = useI18n()
  const s = t.store
  const router = useRouter()
  const slug = tenant.public_slug ?? ''
  const waiting = justPaid && order.status === 'pending_payment'

  // Back from Stripe: the cart is spent. While the webhook has not landed
  // yet, refresh every few seconds until the order shows as paid.
  useEffect(() => {
    if (justPaid && slug) clearCart(slug)
  }, [justPaid, slug])
  useEffect(() => {
    if (!waiting) return
    const id = setInterval(() => router.refresh(), 3000)
    return () => clearInterval(id)
  }, [waiting, router])

  const statuses = s.statuses as Record<string, string>
  const bad = order.status === 'needs_refund' || order.status === 'expired' || order.status === 'cancelled'
  const Icon = bad ? Warning : order.status === 'shipped' ? Truck : order.status === 'ready' || order.status === 'completed' ? Package : waiting ? Clock : CheckCircle

  return (
    <>
      <StoreHeader tenant={tenant} />
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-8">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">{s.orderTitle.replace('{number}', order.orderNumber)}</h1>
          <p className="text-sm text-muted">{s.orderFor.replace('{name}', order.contactName)}</p>
        </div>

        <section className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${bad ? 'border-danger/30 bg-danger/5 text-danger' : 'border-success/30 bg-success/5 text-success'}`}>
          <Icon size={22} weight="fill" className="mt-0.5 shrink-0" />
          <div className="space-y-1 text-sm">
            <p className="font-semibold">{waiting ? s.confirming : statuses[order.status] ?? order.status}</p>
            {justPaid && order.status === 'paid' ? <p>{s.thanks}</p> : null}
            {order.status === 'cancelled' ? <p>{s.cancelledNote}</p> : null}
            {order.status === 'ready' ? <p>{s.pickupReady}</p> : null}
            {order.status === 'shipped' && order.trackingNumber ? (
              <p className="font-mono">
                {s.tracking.replace('{carrier}', order.carrier ?? '').replace('{number}', order.trackingNumber)}
              </p>
            ) : null}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card">
          <h2 className="border-b border-border px-5 py-3 text-sm font-semibold text-foreground">{s.items}</h2>
          <ul className="divide-y divide-border">
            {order.items.map((i) => (
              <li key={i.sku} className="flex items-center justify-between gap-3 px-5 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-foreground">{i.description}</span>
                <span className="font-mono text-xs text-muted">{i.sku}</span>
                <span className="font-mono text-foreground">{formatMoney(i.unitPrice)}</span>
              </li>
            ))}
          </ul>
          <dl className="space-y-1 border-t border-border px-5 py-3 text-sm">
            <Line label={s.subtotal} value={formatMoney(order.subtotal)} />
            {order.fulfillment === 'ship' ? (
              <Line label={s.shipping} value={order.shippingAmount > 0 ? formatMoney(order.shippingAmount) : s.shippingFree} />
            ) : null}
            {order.taxAmount > 0 ? <Line label={s.tax} value={formatMoney(order.taxAmount)} /> : null}
            <Line label={s.total} value={formatMoney(order.total)} strong />
          </dl>
        </section>

        <Link href={`/s/${slug}/catalog`} className="inline-block text-sm font-semibold text-blue hover:text-blue-2">
          {s.keepShopping} →
        </Link>
      </main>
      <StoreFooter tenant={tenant} />
    </>
  )
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className={strong ? 'font-semibold text-foreground' : 'text-muted'}>{label}</dt>
      <dd className={`font-mono ${strong ? 'font-bold text-foreground' : 'text-foreground'}`}>{value}</dd>
    </div>
  )
}
