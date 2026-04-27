'use client'

import Link from 'next/link'
import { useMemo, useState, useTransition } from 'react'
import { ArrowLeft, CreditCard } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import {
  formatMoney,
  formatDateUtc,
  formatDateTime,
} from '@/lib/portal/format'
import type {
  LayawayStatus,
  PaymentMethod,
} from '@/types/database-aliases'
import { createLayawayPaymentSession } from './actions'
import type { LayawayPayActionResult } from './action-types'

export type PortalLayawayDetailView = {
  id: string
  layawayNumber: string
  status: LayawayStatus
  totalDue: number
  paidTotal: number
  balanceRemaining: number
  scheduleKind: 'weekly' | 'biweekly' | 'monthly' | 'custom'
  downPayment: number
  firstPaymentDue: string | null
  finalDueDate: string | null
  createdAt: string
}

export type PortalLayawayPaymentView = {
  id: string
  amount: number
  paymentMethod: PaymentMethod | null
  occurredAt: string
}

export default function PortalLayawayDetail({
  layaway,
  payments,
  banner,
  payEnabled,
}: {
  layaway: PortalLayawayDetailView
  payments: PortalLayawayPaymentView[]
  banner: 'success' | 'cancelled' | 'processing' | null
  payEnabled: boolean
}) {
  const { t } = useI18n()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [amount, setAmount] = useState<string>(() =>
    layaway.balanceRemaining.toFixed(2),
  )

  const numericAmount = useMemo(() => {
    const n = parseFloat(amount)
    return isFinite(n) ? n : 0
  }, [amount])

  const overBalance = numericAmount > layaway.balanceRemaining
  const tooSmall = numericAmount < 1
  const submitDisabled = pending || overBalance || tooSmall

  const onPayClick = () => {
    setError(null)
    if (overBalance) {
      setError(t.portal.layaways.cantExceed)
      return
    }
    if (tooSmall) {
      setError(t.portal.layaways.atLeast)
      return
    }
    startTransition(async () => {
      const res: LayawayPayActionResult = await createLayawayPaymentSession({
        layawayId: layaway.id,
        amount: numericAmount,
      })
      if (!res.ok) {
        setError(
          res.error === 'no_stripe'
            ? t.portal.errors.noStripe
            : res.error === 'amount_invalid'
            ? t.portal.errors.amountInvalid
            : res.error === 'closed'
            ? t.portal.errors.notFound
            : res.error === 'forbidden'
            ? t.portal.errors.forbidden
            : t.portal.errors.generic,
        )
        return
      }
      window.location.assign(res.checkoutUrl)
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link
          href="/portal/layaways"
          className="inline-flex items-center gap-1 text-sm text-ash hover:text-ink"
        >
          <ArrowLeft size={16} weight="regular" />
          <span>{t.portal.common.backToList}</span>
        </Link>
      </div>

      <header className="space-y-1">
        <p className="font-mono text-sm text-ash">
          {t.portal.layaways.layawayNumber} {layaway.layawayNumber}
        </p>
        <h1 className="text-2xl font-bold tracking-tight text-ink">
          {t.portal.layaways.detailTitle}
        </h1>
      </header>

      {banner ? <PaymentBanner kind={banner} /> : null}

      <section className="space-y-4 rounded-xl border border-hairline bg-canvas p-5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm text-ash">{t.portal.layaways.balance}</span>
          <span className="font-mono text-2xl font-bold text-ink">
            {formatMoney(layaway.balanceRemaining)}
          </span>
        </div>
        <dl className="grid grid-cols-2 gap-y-1 text-sm">
          <dt className="text-ash">{t.portal.layaways.paid}</dt>
          <dd className="text-right font-mono text-ink">
            {formatMoney(layaway.paidTotal)}
          </dd>
          <dt className="text-ash">{t.portal.layaways.total}</dt>
          <dd className="text-right font-mono text-ink">
            {formatMoney(layaway.totalDue)}
          </dd>
          <dt className="text-ash">{t.portal.layaways.schedule}</dt>
          <dd className="text-right text-ink">
            {t.portal.layaways.scheduleBadges[layaway.scheduleKind] ??
              layaway.scheduleKind}
          </dd>
          {layaway.firstPaymentDue ? (
            <>
              <dt className="text-ash">{t.portal.layaways.nextDue}</dt>
              <dd className="text-right text-ink">
                {formatDateUtc(layaway.firstPaymentDue)}
              </dd>
            </>
          ) : null}
          {layaway.finalDueDate ? (
            <>
              <dt className="text-ash">{t.portal.layaways.finalDue}</dt>
              <dd className="text-right text-ink">
                {formatDateUtc(layaway.finalDueDate)}
              </dd>
            </>
          ) : null}
        </dl>

        {payEnabled ? (
          <div className="space-y-3 border-t border-hairline pt-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-ash">
              {t.portal.layaways.payNow}
            </h3>
            <p className="text-xs text-ash">{t.portal.layaways.payAmountHelp}</p>
            <label className="block space-y-1">
              <span className="text-sm font-medium text-ink">
                {t.portal.layaways.payAmountLabel}
              </span>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="1"
                max={layaway.balanceRemaining}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 font-mono text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
              />
            </label>
            <button
              type="button"
              onClick={onPayClick}
              disabled={submitDisabled}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-rausch px-4 py-2.5 font-medium text-canvas hover:bg-rausch-deep disabled:opacity-50"
            >
              <CreditCard size={18} weight="regular" />
              {pending ? t.portal.layaways.paying : t.portal.layaways.payNow}
            </button>
            {error ? (
              <div className="rounded-md border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">
                {error}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="space-y-3 rounded-xl border border-hairline bg-canvas p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ash">
          {t.portal.layaways.paymentsHistory}
        </h2>
        {payments.length === 0 ? (
          <p className="text-sm text-ash">{t.portal.layaways.noPayments}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-ash">
                  <th className="pb-2 pr-3 font-medium">
                    {t.portal.loans.paymentsTableDate}
                  </th>
                  <th className="pb-2 pr-3 text-right font-medium">
                    {t.portal.loans.paymentsTableAmount}
                  </th>
                  <th className="pb-2 font-medium">
                    {t.portal.loans.paymentsTableMethod}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2 pr-3 text-ink">
                      {formatDateTime(p.occurredAt)}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-ink">
                      {formatMoney(p.amount)}
                    </td>
                    <td className="py-2 text-ash">
                      {paymentMethodLabel(p.paymentMethod, t)}
                    </td>
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

function paymentMethodLabel(
  m: PaymentMethod | null,
  t: ReturnType<typeof useI18n>['t'],
): string {
  if (m == null) return t.portal.loans.paymentMethodOnline
  switch (m) {
    case 'cash':
      return t.portal.loans.paymentMethodCash
    case 'card':
      return t.portal.loans.paymentMethodCard
    case 'check':
      return t.portal.loans.paymentMethodCheck
    default:
      return t.portal.loans.paymentMethodOther
  }
}

function PaymentBanner({
  kind,
}: {
  kind: 'success' | 'cancelled' | 'processing'
}) {
  const { t } = useI18n()
  const cls =
    kind === 'success'
      ? 'border-success/30 bg-success/5 text-success'
      : kind === 'cancelled'
      ? 'border-warning/30 bg-warning/5 text-warning'
      : 'border-hairline bg-cloud text-ink'
  const msg =
    kind === 'success'
      ? t.portal.layaways.successBanner
      : kind === 'cancelled'
      ? t.portal.layaways.cancelledBanner
      : t.portal.layaways.processingBanner
  return (
    <div className={`rounded-md border px-3 py-2 text-sm ${cls}`}>{msg}</div>
  )
}
