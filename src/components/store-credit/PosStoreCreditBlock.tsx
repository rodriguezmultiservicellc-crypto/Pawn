'use client'

import { useActionState, useState } from 'react'
import { Wallet } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { formatMoney } from '@/lib/format/money'
import { maxRedeemable, r2 } from '@/lib/store-credit/math'
import {
  applyStoreCreditAction,
  undoStoreCreditAction,
  type StoreCreditSaleState,
} from '@/app/(staff)/pos/sales/[id]/store-credit-actions'

export type StoreCreditRedemptionView = {
  id: string
  amount: number
  created_at: string
}

const INITIAL: StoreCreditSaleState = {}

/**
 * Store credit as a tender on an open sale.
 *
 * Deliberately not part of the Add-payment dialog: this posts through the
 * store_credit_redeem_on_sale RPC so the customer's balance, the payment
 * row and the sale's paid_total all move together.
 */
export default function PosStoreCreditBlock({
  saleId,
  customerFirstName,
  balance,
  balanceDue,
  saleStatus,
  redemptionsOnThisSale,
}: {
  saleId: string
  customerFirstName: string
  balance: number
  balanceDue: number
  saleStatus: string
  redemptionsOnThisSale: StoreCreditRedemptionView[]
}) {
  const { t } = useI18n()
  const tp = t.storeCredit.pos
  const [amount, setAmount] = useState('')
  const [applyState, applyAction, applying] = useActionState<
    StoreCreditSaleState,
    FormData
  >(applyStoreCreditAction, INITIAL)
  const [undoState, undoAction] = useActionState<
    StoreCreditSaleState,
    FormData
  >(undoStoreCreditAction, INITIAL)

  const isOpen = saleStatus === 'open'
  // On a closed sale, still show what was applied — the receipt and the
  // void dialog both need it to make sense.
  if (!isOpen && redemptionsOnThisSale.length === 0) return null
  if (isOpen && balance <= 0 && redemptionsOnThisSale.length === 0) return null

  const max = maxRedeemable({ balance, balanceDue })
  const typed = Number.parseFloat(amount)
  const valid = Number.isFinite(typed) && typed > 0 && typed <= max + 0.0001
  const remainingAfter = valid ? r2(balance - typed) : balance

  const error = applyState.error ?? undoState.error
  const errorText = error
    ? (t.storeCredit.errors as Record<string, string>)[error] ??
      t.storeCredit.errors.store_credit_failed
    : null

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <Wallet size={16} weight="bold" className="text-gold" />
        <h3 className="text-sm font-semibold text-foreground">{tp.title}</h3>
      </div>

      {balance > 0 ? (
        <p className="mb-3 text-sm text-muted">
          {tp.available
            .replace('{name}', customerFirstName)
            .replace('{amount}', formatMoney(balance))}
        </p>
      ) : null}

      {errorText ? (
        <div
          className="mb-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger"
          role="alert"
        >
          {errorText}
        </div>
      ) : null}

      {isOpen && max > 0 ? (
        <form action={applyAction} className="mb-4 flex flex-wrap items-end gap-3">
          <input type="hidden" name="sale_id" value={saleId} />
          <label className="text-sm text-foreground">
            <span className="mb-1 block">{tp.amount}</span>
            <input
              type="number"
              name="amount"
              min="0.01"
              max={max}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-36 rounded-xl border-2 border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-blue"
            />
          </label>
          <button
            type="button"
            onClick={() => setAmount(max.toFixed(2))}
            className="mb-0.5 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-background"
          >
            {tp.useMax.replace('{amount}', formatMoney(max))}
          </button>
          <button
            type="submit"
            disabled={!valid || applying}
            className="mb-0.5 rounded-md bg-gold px-3 py-2 text-sm font-medium text-navy hover:bg-gold-2 disabled:opacity-60"
          >
            {applying ? tp.applying : tp.apply}
          </button>
          {valid ? (
            <span className="mb-2 text-xs text-muted">
              {tp.remainingAfter.replace(
                '{amount}',
                formatMoney(remainingAfter),
              )}
            </span>
          ) : null}
        </form>
      ) : null}

      {redemptionsOnThisSale.length > 0 ? (
        <div className="space-y-2">
          {redemptionsOnThisSale.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between gap-2 rounded-md bg-background px-3 py-2 text-sm"
            >
              <span className="text-foreground">
                {tp.appliedLine.replace('{amount}', formatMoney(r.amount))}
              </span>
              {isOpen ? (
                <form action={undoAction}>
                  <input type="hidden" name="sale_id" value={saleId} />
                  <input type="hidden" name="event_id" value={r.id} />
                  <button
                    type="submit"
                    className="text-xs text-muted underline hover:text-foreground"
                  >
                    {tp.undo}
                  </button>
                </form>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}
