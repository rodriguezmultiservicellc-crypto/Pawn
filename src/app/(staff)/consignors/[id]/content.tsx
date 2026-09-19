'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, HandCoins } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { formatMoney } from '@/lib/format/money'
import { daysUntilExpiry } from '@/lib/consignment/math'
import { CommissionField } from '@/components/consignment/CommissionField'
import { Modal, Footer } from '@/components/pos/Modal'
import {
  payOutConsignorAction,
  returnConsignedItemAction,
  updateConsignorAction,
  type ConsignorFormState,
  type PayoutState,
  type ReturnItemState,
} from '../actions'
import type {
  ConsignmentPayableKind,
  ConsignorStatus,
} from '@/types/database-aliases'

export type ConsignorItemRow = {
  id: string
  sku: string
  description: string
  list_price: number | null
  min_price: number | null
  expires_on: string | null
  status: string
}

export type ConsignorPayableRow = {
  id: string
  kind: ConsignmentPayableKind
  reason: string | null
  gross_amount: number
  commission_amount: number
  payable_amount: number
  status: 'open' | 'paid'
  created_at: string
  sale_id: string
  from_return: boolean
  sku: string | null
  description: string | null
}

export type ConsignorPayoutRow = {
  id: string
  payout_number: string
  amount: number
  payout_method: string
  reference: string | null
  paid_at: string
}

type ConsignorRecord = {
  id: string
  consignor_number: string
  business_name: string | null
  customer_id: string | null
  customer_name: string
  customer_contact: string | null
  commission_pct: number
  payout_method: string
  status: ConsignorStatus
  notes: string | null
}

const FORM_INITIAL: ConsignorFormState = {}
const PAYOUT_INITIAL: PayoutState = {}
const RETURN_INITIAL: ReturnItemState = {}

function pct(fraction: number): string {
  return `${(Math.round(fraction * 10000) / 100)
    .toFixed(2)
    .replace(/\.?0+$/, '')}%`
}

export default function ConsignorDetail({
  consignor,
  enabled,
  canManage,
  balance,
  lifetimeGross,
  lifetimeCommission,
  items,
  ledger,
  payouts,
  todayIso,
}: {
  consignor: ConsignorRecord
  enabled: boolean
  canManage: boolean
  balance: number
  lifetimeGross: number
  lifetimeCommission: number
  items: ConsignorItemRow[]
  ledger: ConsignorPayableRow[]
  payouts: ConsignorPayoutRow[]
  todayIso: string
}) {
  const { t } = useI18n()
  const tc = t.consignment
  const [showPayout, setShowPayout] = useState(false)

  const [formState, formAction, formPending] = useActionState<
    ConsignorFormState,
    FormData
  >(updateConsignorAction, FORM_INITIAL)

  const owed = balance > 0

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Link
          href="/consignors"
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft size={14} weight="bold" />
          {tc.detail.backToList}
        </Link>
      </div>

      {/* Header */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted">
              {tc.list.colNumber}
            </div>
            <h1 className="font-display font-mono text-2xl font-bold text-foreground">
              {consignor.consignor_number}
            </h1>
            <div className="mt-1 text-base font-semibold text-foreground">
              {consignor.business_name || consignor.customer_name}
            </div>
            {consignor.customer_id ? (
              <Link
                href={`/customers/${consignor.customer_id}`}
                className="text-xs text-blue hover:underline"
              >
                {consignor.customer_name}
              </Link>
            ) : null}
            {consignor.customer_contact ? (
              <div className="text-xs text-muted">
                {consignor.customer_contact}
              </div>
            ) : null}
          </div>

          <div className="min-w-[180px]">
            <div className="text-xs uppercase tracking-wide text-muted">
              {owed ? tc.detail.balanceOwed : tc.detail.balanceOwedToShop}
            </div>
            <div
              className={`font-mono text-2xl font-bold ${
                balance < 0 ? 'text-warning' : 'text-foreground'
              }`}
            >
              {formatMoney(Math.abs(balance))}
            </div>
            {canManage && enabled ? (
              owed ? (
                <button
                  type="button"
                  onClick={() => setShowPayout(true)}
                  className="mt-2 inline-flex items-center gap-1 rounded-md bg-gold px-3 py-1.5 text-sm font-medium text-navy hover:bg-gold-2"
                >
                  <HandCoins size={14} weight="bold" />
                  {tc.payout.button.replace('{amount}', formatMoney(balance))}
                </button>
              ) : (
                <p className="mt-2 text-xs text-muted">
                  {balance < 0 ? tc.payout.owesShopHint : tc.payout.nothingToPay}
                </p>
              )
            ) : null}
          </div>

          <div>
            <div className="text-xs uppercase tracking-wide text-muted">
              {tc.detail.lifetimeGross}
            </div>
            <div className="font-mono text-sm text-foreground">
              {formatMoney(lifetimeGross)}
            </div>
            <div className="mt-2 text-xs uppercase tracking-wide text-muted">
              {tc.detail.lifetimeCommission}
            </div>
            <div className="font-mono text-sm text-foreground">
              {formatMoney(lifetimeCommission)}
            </div>
          </div>
        </div>

        <p className="mt-3 text-xs text-muted">
          {tc.detail.commissionLine
            .replace('{pct}', pct(consignor.commission_pct))
            .replace('{rest}', pct(1 - consignor.commission_pct))}
        </p>
      </div>

      {/* Terms */}
      {canManage ? (
        <form
          action={formAction}
          className="rounded-xl border border-border bg-card p-4"
        >
          <h2 className="mb-3 text-sm font-semibold text-foreground">
            {tc.form.editTitle}
          </h2>
          <input type="hidden" name="id" value={consignor.id} />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">
                {tc.form.businessName}
              </span>
              <input
                type="text"
                name="business_name"
                defaultValue={consignor.business_name ?? ''}
                className="block w-full rounded-md border border-border bg-card px-3 py-2 text-foreground focus:border-blue focus:outline-none"
              />
            </label>

            <CommissionField
              name="default_commission_pct"
              label={tc.form.commission}
              help={tc.form.commissionHelp}
              defaultFraction={consignor.commission_pct}
            />

            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">
                {tc.form.payoutMethod}
              </span>
              <select
                name="default_payout_method"
                defaultValue={consignor.payout_method}
                className="block w-full rounded-md border border-border bg-card px-3 py-2 text-foreground focus:border-blue focus:outline-none"
              >
                <option value="cash">{t.pos.payment.methodCash}</option>
                <option value="check">{t.pos.payment.methodCheck}</option>
                <option value="card">{t.pos.payment.methodCard}</option>
                <option value="other">{t.pos.payment.methodOther}</option>
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">
                {tc.form.status}
              </span>
              <select
                name="status"
                defaultValue={consignor.status}
                className="block w-full rounded-md border border-border bg-card px-3 py-2 text-foreground focus:border-blue focus:outline-none"
              >
                <option value="active">{tc.list.statusActive}</option>
                <option value="inactive">{tc.list.statusInactive}</option>
              </select>
            </label>

            <label className="block space-y-1 md:col-span-2">
              <span className="text-sm font-medium text-foreground">
                {tc.form.notes}
              </span>
              <textarea
                name="notes"
                rows={2}
                defaultValue={consignor.notes ?? ''}
                className="block w-full rounded-md border border-border bg-card px-3 py-2 text-foreground focus:border-blue focus:outline-none"
              />
            </label>
          </div>
          <div className="mt-3 flex items-center justify-end gap-3">
            {formState.ok ? (
              <span className="text-sm text-success">{tc.form.saved}</span>
            ) : null}
            <button
              type="submit"
              disabled={formPending}
              className="rounded-md bg-gold px-4 py-2 text-sm font-medium text-navy hover:bg-gold-2 disabled:opacity-50"
            >
              {formPending ? tc.form.saving : tc.form.save}
            </button>
          </div>
        </form>
      ) : null}

      <ItemsPanel items={items} todayIso={todayIso} canManage={canManage} />
      <LedgerPanel ledger={ledger} />
      <PayoutsPanel payouts={payouts} />

      {showPayout ? (
        <PayoutDialog
          consignorId={consignor.id}
          amount={balance}
          entryCount={ledger.filter((l) => l.status === 'open').length}
          defaultMethod={consignor.payout_method}
          onClose={() => setShowPayout(false)}
        />
      ) : null}
    </div>
  )
}

function ItemsPanel({
  items,
  todayIso,
  canManage,
}: {
  items: ConsignorItemRow[]
  todayIso: string
  canManage: boolean
}) {
  const { t } = useI18n()
  const tc = t.consignment
  const [returnState, returnAction] = useActionState<ReturnItemState, FormData>(
    returnConsignedItemAction,
    RETURN_INITIAL,
  )

  const errorText = returnState.error
    ? (tc.errors as Record<string, string>)[returnState.error] ??
      tc.errors.consignment_failed
    : null

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold text-foreground">
          {tc.detail.itemsTitle}
        </h2>
      </header>
      {errorText ? (
        <div className="border-b border-border px-3 py-2 text-sm text-danger" role="alert">
          {errorText}
        </div>
      ) : null}
      {items.length === 0 ? (
        <div className="px-3 py-6 text-center text-sm text-muted">
          {tc.detail.itemsEmpty}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2">{tc.detail.colSku}</th>
                <th className="px-3 py-2">{tc.detail.colDescription}</th>
                <th className="px-3 py-2 text-right">
                  {tc.detail.colListPrice}
                </th>
                <th className="px-3 py-2 text-right">{tc.detail.colFloor}</th>
                <th className="px-3 py-2">{tc.detail.colExpires}</th>
                <th className="px-3 py-2">{tc.detail.colItemStatus}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((it) => {
                const days = daysUntilExpiry(it.expires_on, todayIso)
                const expiryText =
                  days == null
                    ? tc.detail.noExpiry
                    : days === 0
                      ? tc.detail.expiresToday
                      : days > 0
                        ? tc.detail.expiresIn.replace('{days}', String(days))
                        : tc.detail.expiredAgo.replace(
                            '{days}',
                            String(Math.abs(days)),
                          )
                const onFloor = it.status === 'available' || it.status === 'held'
                return (
                  <tr key={it.id} className="hover:bg-background/60">
                    <td className="px-3 py-2 font-mono">
                      <Link
                        href={`/inventory/${it.id}`}
                        className="text-blue hover:underline"
                      >
                        {it.sku}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-foreground">
                      {it.description}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-foreground">
                      {it.list_price == null ? '—' : formatMoney(it.list_price)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-foreground">
                      {it.min_price == null ? '—' : formatMoney(it.min_price)}
                    </td>
                    <td
                      className={`px-3 py-2 text-xs ${
                        days != null && days < 0 ? 'text-warning' : 'text-muted'
                      }`}
                    >
                      {expiryText}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted">
                      {it.status}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {canManage && onFloor ? (
                        <form
                          action={returnAction}
                          onSubmit={(e) => {
                            if (!window.confirm(tc.detail.returnItemConfirm)) {
                              e.preventDefault()
                            }
                          }}
                        >
                          <input type="hidden" name="item_id" value={it.id} />
                          <button
                            type="submit"
                            className="text-xs text-muted underline hover:text-foreground"
                          >
                            {tc.detail.returnItem}
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function LedgerPanel({ ledger }: { ledger: ConsignorPayableRow[] }) {
  const { t } = useI18n()
  const tc = t.consignment
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold text-foreground">
          {tc.detail.ledgerTitle}
        </h2>
      </header>
      {ledger.length === 0 ? (
        <div className="px-3 py-6 text-center text-sm text-muted">
          {tc.detail.ledgerEmpty}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2">{tc.detail.colDate}</th>
                <th className="px-3 py-2">{tc.detail.colEvent}</th>
                <th className="px-3 py-2">{tc.detail.colDescription}</th>
                <th className="px-3 py-2 text-right">{tc.detail.colGross}</th>
                <th className="px-3 py-2 text-right">
                  {tc.detail.colCommissionAmount}
                </th>
                <th className="px-3 py-2 text-right">{tc.detail.colPayable}</th>
                <th className="px-3 py-2">{tc.detail.colLedgerStatus}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {ledger.map((row) => (
                <tr key={row.id} className="hover:bg-background/60">
                  <td className="px-3 py-2 font-mono text-xs text-muted">
                    {new Date(row.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2 text-foreground">
                    <Link
                      href={`/pos/sales/${row.sale_id}`}
                      className="text-blue hover:underline"
                    >
                      {row.kind === 'accrual'
                        ? tc.detail.eventAccrual
                        : row.from_return
                          ? tc.detail.eventReversalReturn
                          : tc.detail.eventReversalVoid}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted">
                    {row.sku ? `${row.sku} · ` : ''}
                    {row.description ?? ''}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-foreground">
                    {formatMoney(row.gross_amount)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-muted">
                    {formatMoney(row.commission_amount)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-mono ${
                      row.payable_amount < 0 ? 'text-warning' : 'text-foreground'
                    }`}
                  >
                    {formatMoney(row.payable_amount)}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <span
                      className={`rounded-full border px-2 py-0.5 ${
                        row.status === 'paid'
                          ? 'border-border bg-background text-muted'
                          : 'border-warning/30 bg-warning/10 text-warning'
                      }`}
                    >
                      {row.status === 'paid'
                        ? tc.detail.statusPaid
                        : tc.detail.statusOpen}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function PayoutsPanel({ payouts }: { payouts: ConsignorPayoutRow[] }) {
  const { t } = useI18n()
  const tc = t.consignment
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold text-foreground">
          {tc.detail.payoutsTitle}
        </h2>
      </header>
      {payouts.length === 0 ? (
        <div className="px-3 py-6 text-center text-sm text-muted">
          {tc.detail.payoutsEmpty}
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {payouts.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm"
            >
              <span className="font-mono text-foreground">
                {p.payout_number}
              </span>
              <span className="flex-1 text-xs text-muted">
                {new Date(p.paid_at).toLocaleString()}
                {p.reference ? ` · ${p.reference}` : ''}
              </span>
              <span className="rounded-full border border-border bg-background px-2 py-0.5 text-xs text-muted">
                {p.payout_method}
              </span>
              <span className="font-mono text-foreground">
                {formatMoney(p.amount)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function PayoutDialog({
  consignorId,
  amount,
  entryCount,
  defaultMethod,
  onClose,
}: {
  consignorId: string
  amount: number
  entryCount: number
  defaultMethod: string
  onClose: () => void
}) {
  const { t } = useI18n()
  const tc = t.consignment
  const [state, action, pending] = useActionState<PayoutState, FormData>(
    payOutConsignorAction,
    PAYOUT_INITIAL,
  )

  const errorText = state.error
    ? (tc.errors as Record<string, string>)[state.error] ??
      tc.errors.consignment_failed
    : null

  return (
    <Modal title={tc.payout.title} onClose={onClose}>
      <form action={action} className="space-y-4">
        <input type="hidden" name="consignor_id" value={consignorId} />

        <p className="text-xs text-muted">{tc.payout.help}</p>
        <p className="font-mono text-sm text-foreground">
          {tc.payout.amountLine
            .replace('{amount}', formatMoney(amount))
            .replace('{count}', String(entryCount))}
        </p>

        {errorText ? (
          <div
            className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger"
            role="alert"
          >
            {errorText}
          </div>
        ) : null}

        {state.ok ? (
          <div className="rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm text-success">
            {tc.payout.done
              .replace('{number}', state.payoutNumber ?? '')
              .replace('{amount}', formatMoney(state.amount ?? 0))}
          </div>
        ) : null}

        <label className="block space-y-1">
          <span className="text-sm font-medium text-foreground">
            {tc.payout.method}
          </span>
          <select
            name="payout_method"
            defaultValue={defaultMethod}
            className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none focus:border-blue"
          >
            <option value="cash">{t.pos.payment.methodCash}</option>
            <option value="check">{t.pos.payment.methodCheck}</option>
            <option value="card">{t.pos.payment.methodCard}</option>
            <option value="other">{t.pos.payment.methodOther}</option>
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-medium text-foreground">
            {tc.payout.reference}
          </span>
          <input
            type="text"
            name="reference"
            placeholder={tc.payout.referencePlaceholder}
            className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none focus:border-blue"
          />
        </label>

        <Footer>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border bg-card px-4 py-2 text-sm text-foreground hover:bg-background"
          >
            {state.ok ? t.common.close : t.common.cancel}
          </button>
          {!state.ok ? (
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-gold px-4 py-2 text-sm font-medium text-navy hover:bg-gold-2 disabled:opacity-50"
            >
              {pending ? tc.payout.submitting : tc.payout.submit}
            </button>
          ) : null}
        </Footer>
      </form>
    </Modal>
  )
}
