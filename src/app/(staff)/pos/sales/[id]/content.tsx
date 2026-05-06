'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  ArrowsClockwise,
  CashRegister,
  CheckCircle,
  Lock,
  LockOpen,
  Printer,
  Prohibit,
  CreditCard,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import {
  CardPresentBadge,
  SaleStatusBadge,
} from '@/components/pos/Badges'
import { AddPaymentDialog } from '@/components/pos/AddPaymentDialog'
import { VoidSaleDialog } from '@/components/pos/VoidSaleDialog'
import PosRedemptionBlock, {
  type RedemptionEventView,
} from '@/components/loyalty/PosRedemptionBlock'
import {
  addPaymentAction,
  completeSaleAction,
  markCardPaymentSucceededAction,
  voidSaleAction,
} from './actions'
import type {
  CardPresentStatus,
  PaymentMethod,
  SaleKind,
  SaleStatus,
} from '@/types/database-aliases'

export type SaleDetailView = {
  id: string
  tenant_id: string
  sale_number: string
  sale_kind: SaleKind
  status: SaleStatus
  customer_id: string | null
  customer_name: string | null
  customer_phone: string | null
  customer_email: string | null
  subtotal: number
  tax_amount: number
  tax_rate: number
  discount_amount: number
  total: number
  paid_total: number
  returned_total: number
  balance: number
  notes: string | null
  is_locked: boolean
  completed_at: string | null
  created_at: string
}

export type SaleDetailItem = {
  id: string
  inventory_item_id: string | null
  description: string
  quantity: number
  unit_price: number
  line_discount: number
  line_total: number
  position: number
  returned_qty: number
}

export type SaleDetailPayment = {
  id: string
  amount: number
  payment_method: PaymentMethod
  card_present_status: CardPresentStatus
  stripe_payment_intent_id: string | null
  reader_id: string | null
  notes: string | null
  occurred_at: string
}

export type SaleDetailLoyalty = {
  enabled: boolean
  customerFirstName: string
  customerBalance: number
  redemptionRate: number
  redemptionsOnThisSale: RedemptionEventView[]
}

export default function SaleDetailContent({
  sale,
  items,
  payments,
  layawayId,
  loyalty,
}: {
  sale: SaleDetailView
  items: SaleDetailItem[]
  payments: SaleDetailPayment[]
  layawayId: string | null
  loyalty: SaleDetailLoyalty
}) {
  const { t } = useI18n()
  const [showPay, setShowPay] = useState(false)
  const [showVoid, setShowVoid] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const isOpen = sale.status === 'open'
  const isCompleted = sale.status === 'completed'
  const isFullyReturned = sale.status === 'fully_returned'
  const isVoided = sale.status === 'voided'

  function complete() {
    setError(null)
    startTransition(async () => {
      const res = await completeSaleAction(sale.id)
      if (res.error) setError(translateError(res.error, t))
    })
  }

  function markCard(salePaymentId: string) {
    setError(null)
    startTransition(async () => {
      const res = await markCardPaymentSucceededAction(salePaymentId)
      if (res.error) setError(translateError(res.error, t))
    })
  }

  function printReceipt() {
    if (typeof window === 'undefined') return
    // Open the bilingual PDF endpoint in a new tab. Browser's PDF
    // viewer surfaces the print button. window.print() of the HTML
    // page would print the staff UI itself, not a customer receipt.
    window.open(`/api/print/sale/${sale.id}`, '_blank')
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex items-center justify-between">
        <Link
          href="/pos"
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft size={14} weight="bold" />
          {t.pos.backToList}
        </Link>
        <div className="flex items-center gap-2">
          {sale.is_locked ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-xs font-medium text-foreground">
              <Lock size={12} weight="bold" />
              {t.repair.detail.lockedBadge}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/5 px-2 py-0.5 text-xs font-medium text-warning">
              <LockOpen size={12} weight="bold" />
              {t.repair.detail.unlockedBadge}
            </span>
          )}
          <SaleStatusBadge status={sale.status} />
        </div>
      </div>

      {/* Header */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted">
              {t.pos.sale.saleNumber}
            </div>
            <h1 className="font-display font-mono text-2xl font-bold text-foreground">
              {sale.sale_number}
            </h1>
            <div className="mt-1 text-xs text-muted">
              {sale.sale_kind === 'layaway' ? t.pos.layaway.detail : null}
              {layawayId ? (
                <Link
                  href={`/pos/layaways/${layawayId}`}
                  className="ml-2 underline"
                >
                  {t.pos.layaway.detail} →
                </Link>
              ) : null}
            </div>
          </div>
          <div className="min-w-[200px]">
            <div className="text-xs uppercase tracking-wide text-muted">
              {t.pos.sale.customer}
            </div>
            {sale.customer_id ? (
              <Link
                href={`/customers/${sale.customer_id}`}
                className="text-base font-semibold text-foreground hover:underline"
              >
                {sale.customer_name ?? '—'}
              </Link>
            ) : (
              <div className="text-base font-semibold text-muted">
                {t.pos.sale.anonymous}
              </div>
            )}
            <div className="text-xs text-muted">
              {[sale.customer_phone, sale.customer_email]
                .filter(Boolean)
                .join(' · ') || '—'}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted">
              {t.pos.sale.issuedOn}
            </div>
            <div className="font-mono text-sm text-foreground">
              {new Date(sale.created_at).toLocaleString()}
            </div>
          </div>
          {sale.completed_at ? (
            <div>
              <div className="text-xs uppercase tracking-wide text-muted">
                {t.pos.sale.completedOn}
              </div>
              <div className="font-mono text-sm text-foreground">
                {new Date(sale.completed_at).toLocaleString()}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}

      {/* Action row */}
      <div className="flex flex-wrap items-center gap-2">
        {isOpen && sale.balance > 0 ? (
          <ActionButton
            label={t.pos.sale.addPayment}
            icon={<CashRegister size={14} weight="bold" />}
            onClick={() => setShowPay(true)}
            primary
          />
        ) : null}
        {isOpen && sale.balance <= 0.0001 ? (
          <ActionButton
            label={t.pos.sale.completeSale}
            icon={<CheckCircle size={14} weight="bold" />}
            onClick={complete}
            disabled={pending}
            tone="success"
            primary
          />
        ) : null}
        {isCompleted && !isFullyReturned ? (
          <Link
            href={`/pos/returns/new?sale=${sale.id}`}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:border-foreground"
          >
            <ArrowsClockwise size={14} weight="bold" />
            {t.pos.sale.issueReturn}
          </Link>
        ) : null}
        {!isVoided ? (
          <ActionButton
            label={t.pos.sale.voidSale}
            icon={<Prohibit size={14} weight="bold" />}
            onClick={() => setShowVoid(true)}
            tone="error"
          />
        ) : null}
        {isCompleted ? (
          <button
            type="button"
            onClick={printReceipt}
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:border-foreground"
          >
            <Printer size={14} weight="bold" />
            {t.pos.sale.receiptCopy}
          </button>
        ) : null}
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-card p-4 lg:grid-cols-5">
        <Stat label={t.pos.sale.subtotal} value={fmtMoney(sale.subtotal)} />
        <Stat
          label={t.pos.sale.discount}
          value={fmtMoney(sale.discount_amount)}
        />
        <Stat label={t.pos.sale.tax} value={fmtMoney(sale.tax_amount)} />
        <Stat label={t.pos.sale.total} value={fmtMoney(sale.total)} bold />
        <Stat
          label={t.pos.sale.balance}
          value={fmtMoney(sale.balance)}
          tone={sale.balance > 0 ? 'warning' : 'neutral'}
        />
      </div>

      {/* Loyalty redemption */}
      {loyalty.enabled && sale.customer_id && (
        <PosRedemptionBlock
          saleId={sale.id}
          customerFirstName={loyalty.customerFirstName}
          balance={loyalty.customerBalance}
          redemptionRate={loyalty.redemptionRate}
          saleStatus={sale.status}
          redemptionsOnThisSale={loyalty.redemptionsOnThisSale}
        />
      )}

      {/* Items */}
      <ItemsPanel items={items} />

      {/* Payments */}
      <PaymentsPanel payments={payments} onMarkSucceeded={markCard} />

      {showPay ? (
        <AddPaymentDialog
          saleId={sale.id}
          defaultAmount={sale.balance}
          onClose={() => setShowPay(false)}
          onSubmit={addPaymentAction}
        />
      ) : null}
      {showVoid ? (
        <VoidSaleDialog
          saleId={sale.id}
          onClose={() => setShowVoid(false)}
          onSubmit={voidSaleAction}
        />
      ) : null}
    </div>
  )
}

function ItemsPanel({ items }: { items: SaleDetailItem[] }) {
  const { t } = useI18n()
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold text-foreground">
          {t.pos.sale.itemsTitle}
        </h2>
      </header>
      {items.length === 0 ? (
        <div className="px-3 py-6 text-center text-sm text-muted">
          {t.pos.sale.noItems}
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-3 py-2">{t.pos.cart.itemDescription}</th>
              <th className="px-3 py-2 text-right">{t.pos.cart.qty}</th>
              <th className="px-3 py-2 text-right">{t.pos.cart.unitPrice}</th>
              <th className="px-3 py-2 text-right">
                {t.pos.cart.lineDiscount}
              </th>
              <th className="px-3 py-2 text-right">{t.pos.cart.lineTotal}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-b border-border/60">
                <td className="px-3 py-2">
                  <div className="font-medium text-foreground">{it.description}</div>
                  {it.returned_qty > 0 ? (
                    <div className="text-xs text-muted">
                      {t.pos.cart.qty}{' '}
                      <span className="font-mono">
                        −{it.returned_qty}
                      </span>{' '}
                      ({t.pos.return.title})
                    </div>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-right font-mono text-foreground">
                  {it.quantity}
                </td>
                <td className="px-3 py-2 text-right font-mono text-foreground">
                  {fmtMoney(it.unit_price)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-foreground">
                  {fmtMoney(it.line_discount)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-foreground">
                  {fmtMoney(it.line_total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function PaymentsPanel({
  payments,
  onMarkSucceeded,
}: {
  payments: SaleDetailPayment[]
  onMarkSucceeded: (id: string) => void
}) {
  const { t } = useI18n()
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold text-foreground">
          {t.pos.sale.paymentsTitle}
        </h2>
      </header>
      {payments.length === 0 ? (
        <div className="px-3 py-6 text-center text-sm text-muted">
          {t.pos.sale.noPayments}
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {payments.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm"
            >
              <div className="flex-1">
                <div className="font-mono text-foreground">{fmtMoney(p.amount)}</div>
                <div className="text-xs text-muted">
                  {new Date(p.occurred_at).toLocaleString()}
                </div>
              </div>
              <span className="rounded-full border border-border bg-background px-2 py-0.5 text-xs text-foreground">
                {p.payment_method}
              </span>
              {p.payment_method === 'card' ? (
                <CardPresentBadge status={p.card_present_status} />
              ) : null}
              {p.payment_method === 'card' &&
              p.card_present_status === 'pending' ? (
                <button
                  type="button"
                  onClick={() => onMarkSucceeded(p.id)}
                  className="inline-flex items-center gap-1 rounded-md border border-warning/30 bg-warning/5 px-2 py-1 text-xs font-medium text-warning hover:bg-warning/10"
                  title={t.pos.payment.markSucceededHelp}
                >
                  <CreditCard size={12} weight="bold" />
                  {t.pos.payment.markSucceededTest}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ActionButton({
  label,
  icon,
  onClick,
  disabled,
  primary,
  tone,
}: {
  label: string
  icon: React.ReactNode
  onClick: () => void
  disabled?: boolean
  primary?: boolean
  tone?: 'success' | 'warning' | 'error'
}) {
  let cls =
    'inline-flex items-center gap-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50'
  if (primary && tone === 'success') {
    cls += ' border-success bg-success text-white hover:bg-success-deep'
  } else if (primary) {
    cls += ' border-gold bg-gold text-navy hover:bg-gold-2'
  } else if (tone === 'success') {
    cls += ' border-success/30 bg-success/5 text-success hover:bg-success/10'
  } else if (tone === 'warning') {
    cls += ' border-warning/30 bg-warning/5 text-warning hover:bg-warning/10'
  } else if (tone === 'error') {
    cls += ' border-danger/30 bg-danger/5 text-danger hover:bg-danger/10'
  } else {
    cls += ' border-border bg-card text-foreground hover:border-foreground'
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cls}>
      {icon}
      {label}
    </button>
  )
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
  const tn = tone === 'warning' ? 'text-warning' : 'text-foreground'
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
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

function translateError(
  code: string,
  t: ReturnType<typeof useI18n>['t'],
): string {
  const errors = t.pos.errors as Record<string, string>
  return errors[code] ?? errors.generic
}
