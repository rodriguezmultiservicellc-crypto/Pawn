'use client'

import Link from 'next/link'
import { Globe } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { formatMoney } from '@/lib/format/money'
import { absoluteTimestamp } from '@/lib/format/datetime'
import { ORDER_STATUS_TONE } from '@/components/store/order-status'

export type OrderTab = 'action' | 'refund' | 'done' | 'all'

export type OrderRow = {
  id: string
  orderNumber: string
  customer: string
  fulfillment: 'pickup' | 'ship'
  total: number
  status: string
  paidAt: string | null
}

const TABS: OrderTab[] = ['action', 'refund', 'done', 'all']

export default function OnlineOrdersContent({ rows, tab }: { rows: OrderRow[]; tab: OrderTab }) {
  const { t } = useI18n()
  const o = t.onlineOrders
  const statuses = o.statuses as Record<string, string>

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Globe size={28} className="text-gold" />
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">{o.title}</h1>
          <p className="text-sm text-muted">{o.subtitle}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((k) => (
          <Link
            key={k}
            href={k === 'action' ? '/pos/online-orders' : `/pos/online-orders?tab=${k}`}
            className={`rounded-full border px-3 py-1 text-sm ${
              k === tab ? 'border-blue bg-blue/10 font-semibold text-blue' : 'border-border bg-card text-foreground hover:bg-background'
            }`}
          >
            {o.tabs[k]}
          </Link>
        ))}
      </div>

      <section className="rounded-xl border border-border bg-card">
        {rows.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted">{o.empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-2 font-semibold">{o.columns.number}</th>
                  <th className="px-3 py-2 font-semibold">{o.columns.customer}</th>
                  <th className="px-3 py-2 font-semibold">{o.columns.fulfillment}</th>
                  <th className="px-3 py-2 font-semibold">{o.columns.status}</th>
                  <th className="px-3 py-2 font-semibold">{o.columns.paid}</th>
                  <th className="px-5 py-2 text-right font-semibold">{o.columns.total}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-background">
                    <td className="px-5 py-2">
                      <Link href={`/pos/online-orders/${r.id}`} className="font-mono text-blue hover:text-blue-2">
                        {r.orderNumber}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-foreground">{r.customer}</td>
                    <td className="px-3 py-2 text-muted">{o.fulfillment[r.fulfillment]}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${ORDER_STATUS_TONE[r.status] ?? ''}`}>
                        {statuses[r.status] ?? r.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted">{r.paidAt ? absoluteTimestamp(r.paidAt) : '—'}</td>
                    <td className="px-5 py-2 text-right font-mono">{formatMoney(r.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
