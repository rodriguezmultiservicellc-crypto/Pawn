'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { ArrowLeft, CreditCard } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { formatMoney, formatDateUtc, formatDateTime } from '@/lib/portal/format'
import type {
  LoanEventType,
  LoanStatus,
  PaymentMethod,
} from '@/types/database-aliases'
import { createLoanPayoffSession } from './actions'
import type { PayoffActionResult } from './action-types'

export type PortalLoanDetailView = {
  id: string
  ticketNumber: string
  principal: number
  interestRateMonthly: number
  termDays: number
  issueDate: string
  dueDate: string
  daysToDue: number
  status: LoanStatus
  payoff: number
  principalOutstanding: number
  interestAccrued: number
  collateralLines: string[]
}

export type PortalLoanEventView = {
  id: string
  eventType: LoanEventType
  amount: number | null
  principal_paid: number
  interest_paid: number
  fees_paid: number
  paymentMethod: PaymentMethod | null
  occurredAt: string
  notes: string | null
}

export default function PortalLoanDetail({
  loan,
  events,
  banner,
  payoffEnabled,
  onlinePaymentsAvailable,
}: {
  loan: PortalLoanDetailView
  events: PortalLoanEventView[]
  banner: 'success' | 'cancelled' | 'processing' | null
  payoffEnabled: boolean
  onlinePaymentsAvailable: boolean
}) {
  const { t } = useI18n()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const paymentEvents = events.filter(
    (e) => e.eventType === 'payment' || e.eventType === 'redemption',
  )

  const onPayClick = () => {
    setError(null)
    startTransition(async () => {
      const res: PayoffActionResult = await createLoanPayoffSession({
        loanId: loan.id,
      })
      if (!res.ok) {
        setError(
          res.error === 'no_stripe'
            ? t.portal.errors.noStripe
            : res.error === 'closed'
            ? t.portal.errors.notFound
            : res.error === 'forbidden'
            ? t.portal.errors.forbidden
            : t.portal.errors.generic,
        )
        return
      }
      // Hard nav so cookies/refresh land cleanly when Stripe bounces back.
      window.location.assign(res.checkoutUrl)
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link
          href="/portal/loans"
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft size={16} weight="regular" />
          <span>{t.portal.common.backToList}</span>
        </Link>
      </div>

      <header className="space-y-1">
        <p className="font-mono text-sm text-muted">
          {t.portal.loans.ticket} {loan.ticketNumber}
        </p>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {t.portal.loans.detailTitle}
        </h1>
      </header>

      {banner ? <PaymentBanner kind={banner} /> : null}

      {/* Payoff panel */}
      <section className="space-y-3 rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          {t.portal.loans.payoffPanelTitle}
        </h2>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm text-muted">
            {t.portal.loans.payoffAmount}
          </span>
          <span className="font-mono text-2xl font-bold text-foreground">
            {formatMoney(loan.payoff)}
          </span>
        </div>
        <dl className="grid grid-cols-2 gap-y-1 text-sm">
          <dt className="text-muted">{t.portal.loans.principalOutstanding}</dt>
          <dd className="text-right font-mono text-foreground">
            {formatMoney(loan.principalOutstanding)}
          </dd>
          <dt className="text-muted">{t.portal.loans.interestAccrued}</dt>
          <dd className="text-right font-mono text-foreground">
            {formatMoney(loan.interestAccrued)}
          </dd>
        </dl>
        {payoffEnabled ? (
          <>
            <p className="text-xs text-muted">{t.portal.loans.payoffPanelHelp}</p>
            <button
              type="button"
              onClick={onPayClick}
              disabled={pending}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-gold px-4 py-2.5 font-medium text-navy hover:bg-gold-2 disabled:opacity-50"
            >
              <CreditCard size={18} weight="regular" />
              {pending ? t.portal.loans.paying : t.portal.loans.payNow}
            </button>
            {error ? (
              <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
                {error}
              </div>
            ) : null}
          </>
        ) : !onlinePaymentsAvailable && loan.payoff > 0 ? (
          <div className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
            {t.portal.loans.payInStoreNotice}
          </div>
        ) : null}
      </section>

      {/* Summary */}
      <section className="space-y-3 rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          {t.portal.loans.summary}
        </h2>
        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-muted">{t.portal.loans.principal}</dt>
          <dd className="text-right font-mono text-foreground">
            {formatMoney(loan.principal)}
          </dd>
          <dt className="text-muted">{t.portal.loans.issuedOn}</dt>
          <dd className="text-right text-foreground">
            {formatDateUtc(loan.issueDate)}
          </dd>
          <dt className="text-muted">{t.portal.loans.dueDate}</dt>
          <dd className="text-right text-foreground">{formatDateUtc(loan.dueDate)}</dd>
          <dt className="text-muted">{t.portal.loans.collateralLine}</dt>
          <dd className="text-right text-foreground">
            {loan.collateralLines.length === 0
              ? '—'
              : loan.collateralLines.join(', ')}
          </dd>
        </dl>
      </section>

      {/* Payment history */}
      <section className="space-y-3 rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          {t.portal.loans.paymentsHistory}
        </h2>
        {paymentEvents.length === 0 ? (
          <p className="text-sm text-muted">{t.portal.loans.noPayments}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="pb-2 pr-3 font-medium">
                    {t.portal.loans.paymentsTableDate}
                  </th>
                  <th className="pb-2 pr-3 font-medium">
                    {t.portal.loans.paymentsTableType}
                  </th>
                  <th className="pb-2 pr-3 text-right font-medium">
                    {t.portal.loans.paymentsTableAmount}
                  </th>
                  <th className="pb-2 pr-3 text-right font-medium">
                    {t.portal.loans.paymentsTablePrincipal}
                  </th>
                  <th className="pb-2 pr-3 text-right font-medium">
                    {t.portal.loans.paymentsTableInterest}
                  </th>
                  <th className="pb-2 font-medium">
                    {t.portal.loans.paymentsTableMethod}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {paymentEvents.map((e) => (
                  <tr key={e.id}>
                    <td className="py-2 pr-3 text-foreground">
                      {formatDateTime(e.occurredAt)}
                    </td>
                    <td className="py-2 pr-3 text-foreground">
                      {eventLabel(e.eventType, t)}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-foreground">
                      {e.amount == null ? '—' : formatMoney(e.amount)}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-foreground">
                      {formatMoney(e.principal_paid)}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-foreground">
                      {formatMoney(e.interest_paid)}
                    </td>
                    <td className="py-2 text-muted">
                      {paymentMethodLabel(e.paymentMethod, t)}
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

function eventLabel(
  type: LoanEventType,
  t: ReturnType<typeof useI18n>['t'],
): string {
  switch (type) {
    case 'issued':
      return t.portal.loans.eventIssued
    case 'payment':
      return t.portal.loans.eventPayment
    case 'extension':
      return t.portal.loans.eventExtension
    case 'redemption':
      return t.portal.loans.eventRedemption
    case 'forfeiture':
      return t.portal.loans.eventForfeiture
    case 'void':
      return t.portal.loans.eventVoid
    default:
      return type
  }
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
      : 'border-border bg-background text-foreground'
  const msg =
    kind === 'success'
      ? t.portal.loans.successBanner
      : kind === 'cancelled'
      ? t.portal.loans.cancelledBanner
      : t.portal.loans.processingBanner
  return (
    <div className={`rounded-md border px-3 py-2 text-sm ${cls}`}>{msg}</div>
  )
}
