'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Package, Truck, Warning } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { formatMoney } from '@/lib/format/money'
import { absoluteTimestamp } from '@/lib/format/datetime'
import { ORDER_STATUS_TONE } from '@/components/store/order-status'
import { advanceOrderAction, handOverOrderAction, shipOrderAction } from '../actions'

export type OrderDetail = {
  id: string
  orderNumber: string
  status: string
  fulfillment: 'pickup' | 'ship'
  contactName: string
  contactEmail: string
  contactPhone: string | null
  address: string | null
  signatureRequired: boolean
  subtotal: number
  shipping: number
  tax: number
  total: number
  saleId: string | null
  customerId: string | null
  createdAt: string
  paidAt: string | null
  readyAt: string | null
  shippedAt: string | null
  completedAt: string | null
  carrier: string | null
  tracking: string | null
  pickedUpBy: string | null
  pickupId: string | null
  signatureUrl: string | null
  refundReason: string | null
  items: Array<{ inventoryItemId: string; sku: string; description: string; price: number }>
}

const btnPrimary =
  'inline-flex items-center gap-2 rounded-xl bg-gold px-4 py-2 text-sm font-bold text-navy transition-all hover:-translate-y-0.5 hover:bg-gold-2 hover:shadow-lg disabled:opacity-50'
const btnSecondary =
  'inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground hover:border-blue hover:text-blue disabled:opacity-50'
const inputCls =
  'w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none'

export default function OnlineOrderDetail({ order }: { order: OrderDetail }) {
  const { t } = useI18n()
  const o = t.onlineOrders
  const d = o.detail
  const statuses = o.statuses as Record<string, string>
  const errors = o.errors as Record<string, string>
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [carrier, setCarrier] = useState('')
  const [tracking, setTracking] = useState('')

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setError(null)
    start(async () => {
      const r = await fn()
      if (!r.ok) setError(errors[r.error] ?? errors.generic)
    })
  }

  const s = order.status
  const timeline: Array<[string, string | null]> = [
    [d.created, order.createdAt],
    [d.paidAt, order.paidAt],
    [d.readyAt, order.readyAt],
    [d.shippedAt, order.shippedAt],
    [d.completedAt, order.completedAt],
  ]

  return (
    <div className="space-y-6">
      <div>
        <Link href="/pos/online-orders" className="text-sm text-muted hover:text-foreground">
          ← {d.back}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-bold text-foreground">
            <span className="font-mono">{order.orderNumber}</span>
          </h1>
          <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${ORDER_STATUS_TONE[s] ?? ''}`}>
            {statuses[s] ?? s}
          </span>
          <span className="text-sm text-muted">{o.fulfillment[order.fulfillment]}</span>
        </div>
      </div>

      {s === 'needs_refund' ? (
        <p className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          <Warning size={18} weight="fill" className="mt-0.5 shrink-0" />
          {d.refundHelp.replace('{reason}', order.refundReason ?? '—')}
        </p>
      ) : null}

      {/* Next step */}
      {['paid', 'picking', 'ready', 'shipped'].includes(s) ? (
        <section className="space-y-3 rounded-xl border border-border bg-card p-5">
          {s === 'paid' ? (
            <button type="button" disabled={pending} className={btnSecondary} onClick={() => run(() => advanceOrderAction(order.id, 'picking'))}>
              <Package size={16} /> {o.actions.startPicking}
            </button>
          ) : null}

          {(s === 'paid' || s === 'picking') && order.fulfillment === 'pickup' ? (
            <button type="button" disabled={pending} className={btnPrimary} onClick={() => run(() => advanceOrderAction(order.id, 'ready'))}>
              <Package size={16} weight="bold" /> {o.actions.markReady}
            </button>
          ) : null}

          {(s === 'paid' || s === 'picking') && order.fulfillment === 'ship' ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-end">
              <label className="space-y-1 text-sm">
                <span className="font-semibold text-foreground">{o.actions.carrier}</span>
                <input value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder={o.actions.carrierPlaceholder} className={inputCls} />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-semibold text-foreground">{o.actions.tracking}</span>
                <input value={tracking} onChange={(e) => setTracking(e.target.value)} className={`${inputCls} font-mono`} />
              </label>
              <button type="button" disabled={pending} className={btnPrimary} onClick={() => run(() => shipOrderAction(order.id, carrier, tracking))}>
                <Truck size={16} weight="bold" /> {o.actions.ship}
              </button>
            </div>
          ) : null}

          {s === 'ready' ? (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault()
                const fd = new FormData(e.currentTarget)
                fd.set('order_id', order.id)
                run(() => handOverOrderAction(fd))
              }}
            >
              <h2 className="text-sm font-semibold text-foreground">{o.actions.handOver}</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span className="font-semibold text-foreground">{o.actions.pickupName}</span>
                  <input name="pickup_name" required defaultValue={order.contactName} className={inputCls} />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-semibold text-foreground">{o.actions.pickupId}</span>
                  <input name="pickup_id" required className={inputCls} />
                </label>
              </div>
              <label className="block space-y-1 text-sm">
                <span className="font-semibold text-foreground">{o.actions.signature}</span>
                <input name="signature_file" type="file" required accept="image/*,application/pdf" capture="environment" className="block text-sm" />
              </label>
              <button type="submit" disabled={pending} className={btnPrimary}>
                {pending ? o.actions.working : o.actions.confirmHandOver}
              </button>
            </form>
          ) : null}

          {s === 'shipped' ? (
            <button type="button" disabled={pending} className={btnSecondary} onClick={() => run(() => advanceOrderAction(order.id, 'completed'))}>
              {o.actions.delivered}
            </button>
          ) : null}

          {error ? <p className="text-sm text-danger">{error}</p> : null}
        </section>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="space-y-2 rounded-xl border border-border bg-card p-5 text-sm">
          <h2 className="font-semibold text-foreground">{d.contact}</h2>
          <p className="text-foreground">{order.contactName}</p>
          <p className="text-muted">{order.contactEmail}</p>
          {order.contactPhone ? <p className="text-muted">{order.contactPhone}</p> : null}
          {order.address ? (
            <>
              <h3 className="pt-2 font-semibold text-foreground">{d.shipTo}</h3>
              <p className="whitespace-pre-line text-foreground">{order.address}</p>
              {order.signatureRequired ? <p className="text-xs font-semibold text-warning">{d.signatureRequired}</p> : null}
            </>
          ) : null}
          <div className="flex flex-wrap gap-3 pt-2">
            {order.saleId ? (
              <Link href={`/pos/sales/${order.saleId}`} className="text-blue hover:text-blue-2">
                {d.sale} →
              </Link>
            ) : null}
            {order.customerId ? (
              <Link href={`/customers/${order.customerId}`} className="text-blue hover:text-blue-2">
                {d.customer} →
              </Link>
            ) : null}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card lg:col-span-2">
          <h2 className="border-b border-border px-5 py-3 text-sm font-semibold text-foreground">{d.items}</h2>
          <ul className="divide-y divide-border">
            {order.items.map((i) => (
              <li key={i.inventoryItemId} className="flex items-center gap-3 px-5 py-2 text-sm">
                <Link href={`/inventory/${i.inventoryItemId}`} className="font-mono text-blue hover:text-blue-2">
                  {i.sku}
                </Link>
                <span className="min-w-0 flex-1 truncate text-foreground">{i.description}</span>
                <span className="font-mono">{formatMoney(i.price)}</span>
              </li>
            ))}
          </ul>
          <dl className="space-y-1 border-t border-border px-5 py-3 text-sm">
            <Pair label={d.subtotal} value={formatMoney(order.subtotal)} />
            {order.shipping > 0 ? <Pair label={d.shipping} value={formatMoney(order.shipping)} /> : null}
            {order.tax > 0 ? <Pair label={d.tax} value={formatMoney(order.tax)} /> : null}
            <Pair label={d.total} value={formatMoney(order.total)} strong />
          </dl>
        </section>
      </div>

      <section className="space-y-2 rounded-xl border border-border bg-card p-5 text-sm">
        <h2 className="font-semibold text-foreground">{d.timeline}</h2>
        <ul className="space-y-1">
          {timeline
            .filter(([, at]) => at)
            .map(([label, at]) => (
              <li key={label} className="flex justify-between gap-3">
                <span className="text-muted">{label}</span>
                <span className="text-foreground">{absoluteTimestamp(at as string)}</span>
              </li>
            ))}
        </ul>
        {order.tracking ? (
          <p className="font-mono text-foreground">{d.tracking.replace('{carrier}', order.carrier ?? '').replace('{number}', order.tracking)}</p>
        ) : null}
        {order.pickedUpBy ? (
          <p className="text-foreground">{d.pickedUpBy.replace('{name}', order.pickedUpBy).replace('{id}', order.pickupId ?? '')}</p>
        ) : null}
        {order.signatureUrl ? (
          <a href={order.signatureUrl} target="_blank" rel="noreferrer" className="text-blue hover:text-blue-2">
            {d.signature} →
          </a>
        ) : null}
      </section>
    </div>
  )
}

function Pair({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt className={strong ? 'font-semibold text-foreground' : 'text-muted'}>{label}</dt>
      <dd className={`font-mono ${strong ? 'font-bold' : ''} text-foreground`}>{value}</dd>
    </div>
  )
}
