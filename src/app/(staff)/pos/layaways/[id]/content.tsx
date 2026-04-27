'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  CashRegister,
  Prohibit,
  Calendar,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { LayawayStatusBadge } from '@/components/pos/Badges'
import { LayawayPaymentDialog } from '@/components/pos/LayawayPaymentDialog'
import { CancelLayawayDialog } from '@/components/pos/CancelLayawayDialog'
import { addLayawayPaymentAction, cancelLayawayAction } from './actions'
import type {
  LayawayScheduleKind,
  LayawayStatus,
  PaymentMethod,
} from '@/types/database-aliases'

export type LayawayDetailView = {
  id: string
  tenant_id: string
  sale_id: string
  layaway_number: string
  status: LayawayStatus
  customer_id: string
  customer_name: string
  customer_phone: string | null
  total_due: number
  paid_total: number
  balance_remaining: number
  down_payment: number
  schedule_kind: LayawayScheduleKind
  first_payment_due: string | null
  final_due_date: string | null
  cancellation_fee_pct: number
  cancelled_at: string | null
  completed_at: string | null
  notes: string | null
  created_at: string
}

export type LayawayDetailItem = {
  id: string
  inventory_item_id: string | null
  description: string
  quantity: number
  unit_price: number
  line_total: number
}

export type LayawayDetailPayment = {
  id: string
  amount: number
  payment_method: PaymentMethod
  notes: string | null
  occurred_at: string
}

export default function LayawayDetailContent({
  layaway,
  items,
  payments,
}: {
  layaway: LayawayDetailView
  items: LayawayDetailItem[]
  payments: LayawayDetailPayment[]
}) {
  const { t } = useI18n()
  const [showPay, setShowPay] = useState(false)
  const [showCancel, setShowCancel] = useState(false)

  const isActive = layaway.status === 'active'

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex items-center justify-between">
        <Link
          href="/pos/layaways"
          className="inline-flex items-center gap-1 text-sm text-ash hover:text-ink"
        >
          <ArrowLeft size={14} weight="bold" />
          {t.pos.layaway.backToList}
        </Link>
        <LayawayStatusBadge status={layaway.status} />
      </div>

      {/* Header */}
      <div className="rounded-lg border border-hairline bg-canvas p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-ash">
              {t.pos.layaway.layawayNumber}
            </div>
            <h1 className="font-mono text-2xl font-bold text-ink">
              {layaway.layaway_number}
            </h1>
            <Link
              href={`/pos/sales/${layaway.sale_id}`}
              className="mt-1 inline-block text-xs text-ash underline"
            >
              {t.pos.sale.saleNumber} →
            </Link>
          </div>
          <div className="min-w-[200px]">
            <div className="text-xs uppercase tracking-wide text-ash">
              {t.pos.sale.customer}
            </div>
            <Link
              href={`/customers/${layaway.customer_id}`}
              className="text-base font-semibold text-ink hover:underline"
            >
              {layaway.customer_name}
            </Link>
            <div className="text-xs text-ash">
              {layaway.customer_phone ?? '—'}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-ash">
              {t.pos.layaway.created}
            </div>
            <div className="font-mono text-sm text-ink">
              {new Date(layaway.created_at).toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      {/* Action row */}
      <div className="flex flex-wrap items-center gap-2">
        {isActive ? (
          <button
            type="button"
            onClick={() => setShowPay(true)}
            className="inline-flex items-center gap-1 rounded-md bg-rausch px-3 py-2 text-sm font-medium text-canvas hover:bg-rausch-deep"
          >
            <CashRegister size={14} weight="bold" />
            {t.pos.layaway.addPayment}
          </button>
        ) : null}
        {isActive ? (
          <button
            type="button"
            onClick={() => setShowCancel(true)}
            className="inline-flex items-center gap-1 rounded-md border border-error/30 bg-error/5 px-3 py-2 text-sm font-medium text-error hover:bg-error/10"
          >
            <Prohibit size={14} weight="bold" />
            {t.pos.layaway.cancel}
          </button>
        ) : null}
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 gap-3 rounded-lg border border-hairline bg-canvas p-4 lg:grid-cols-4">
        <Stat label={t.pos.sale.total} value={fmtMoney(layaway.total_due)} />
        <Stat
          label={t.pos.layaway.paidTotal}
          value={fmtMoney(layaway.paid_total)}
        />
        <Stat
          label={t.pos.layaway.balanceRemaining}
          value={fmtMoney(layaway.balance_remaining)}
          tone={layaway.balance_remaining > 0 ? 'warning' : 'neutral'}
          bold
        />
        <Stat
          label={t.pos.layaway.firstPaymentDue}
          value={layaway.first_payment_due ?? '—'}
        />
      </div>

      {/* Schedule preview */}
      <section className="rounded-lg border border-hairline bg-canvas p-4">
        <header className="mb-2 flex items-center gap-2">
          <Calendar size={14} weight="regular" className="text-ash" />
          <h2 className="text-sm font-semibold text-ink">
            {t.pos.layaway.schedulePreview}
          </h2>
        </header>
        <dl className="grid grid-cols-2 gap-3 text-xs lg:grid-cols-4">
          <div>
            <dt className="text-ash">{t.pos.layaway.schedule}</dt>
            <dd className="text-ink">
              {scheduleLabel(layaway.schedule_kind, t)}
            </dd>
          </div>
          <div>
            <dt className="text-ash">{t.pos.layaway.downPayment}</dt>
            <dd className="font-mono text-ink">
              {fmtMoney(layaway.down_payment)}
            </dd>
          </div>
          <div>
            <dt className="text-ash">{t.pos.layaway.finalDue}</dt>
            <dd className="font-mono text-ink">
              {layaway.final_due_date ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-ash">{t.pos.layaway.cancellationFeePct}</dt>
            <dd className="font-mono text-ink">
              {(layaway.cancellation_fee_pct * 100).toFixed(2)}%
            </dd>
          </div>
        </dl>
      </section>

      {/* Items */}
      <section className="overflow-hidden rounded-lg border border-hairline bg-canvas">
        <header className="border-b border-hairline px-3 py-2">
          <h2 className="text-sm font-semibold text-ink">
            {t.pos.sale.itemsTitle}
          </h2>
          <p className="text-xs text-ash">{t.pos.layaway.itemsHeldHelp}</p>
        </header>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-ash">
              <th className="px-3 py-2">{t.pos.cart.itemDescription}</th>
              <th className="px-3 py-2 text-right">{t.pos.cart.qty}</th>
              <th className="px-3 py-2 text-right">{t.pos.cart.unitPrice}</th>
              <th className="px-3 py-2 text-right">{t.pos.cart.lineTotal}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-b border-hairline/60">
                <td className="px-3 py-2 text-ink">{it.description}</td>
                <td className="px-3 py-2 text-right font-mono text-ink">
                  {it.quantity}
                </td>
                <td className="px-3 py-2 text-right font-mono text-ink">
                  {fmtMoney(it.unit_price)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-ink">
                  {fmtMoney(it.line_total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Payments */}
      <section className="overflow-hidden rounded-lg border border-hairline bg-canvas">
        <header className="border-b border-hairline px-3 py-2">
          <h2 className="text-sm font-semibold text-ink">
            {t.pos.layaway.paymentsHistory}
          </h2>
        </header>
        {payments.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-ash">
            {t.pos.sale.noPayments}
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {payments.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
              >
                <div className="flex-1">
                  <div
                    className={`font-mono ${p.amount < 0 ? 'text-error' : 'text-ink'}`}
                  >
                    {fmtMoney(p.amount)}
                  </div>
                  <div className="text-xs text-ash">
                    {new Date(p.occurred_at).toLocaleString()}
                  </div>
                  {p.notes ? (
                    <div className="text-xs text-ash">{p.notes}</div>
                  ) : null}
                </div>
                <span className="rounded-full border border-hairline bg-cloud px-2 py-0.5 text-xs text-ink">
                  {p.payment_method}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {showPay ? (
        <LayawayPaymentDialog
          layawayId={layaway.id}
          defaultAmount={layaway.balance_remaining}
          onClose={() => setShowPay(false)}
          onSubmit={addLayawayPaymentAction}
        />
      ) : null}
      {showCancel ? (
        <CancelLayawayDialog
          layawayId={layaway.id}
          paidTotal={layaway.paid_total}
          cancellationFeePct={layaway.cancellation_fee_pct}
          onClose={() => setShowCancel(false)}
          onSubmit={cancelLayawayAction}
        />
      ) : null}
    </div>
  )
}

function scheduleLabel(
  k: LayawayScheduleKind,
  t: ReturnType<typeof useI18n>['t'],
): string {
  switch (k) {
    case 'weekly':
      return t.pos.layaway.scheduleWeekly
    case 'biweekly':
      return t.pos.layaway.scheduleBiweekly
    case 'monthly':
      return t.pos.layaway.scheduleMonthly
    case 'custom':
      return t.pos.layaway.scheduleCustom
  }
}

function Stat({
  label,
  value,
  bold,
  tone = 'neutral',
}: {
  label: string
  value: string
  bold?: boolean
  tone?: 'neutral' | 'warning'
}) {
  const tn = tone === 'warning' ? 'text-warning' : 'text-ink'
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-ash">{label}</div>
      <div
        className={`font-mono ${bold ? 'text-base font-semibold' : 'text-sm'} ${tn}`}
      >
        {value}
      </div>
    </div>
  )
}

function fmtMoney(v: number): string {
  if (!isFinite(v)) return '—'
  return v.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  })
}
