'use client'

import { useActionState, useEffect, useState } from 'react'
import { useI18n } from '@/lib/i18n/context'
import { formatMoney } from '@/lib/format/money'
import { Modal, Footer } from '@/components/pos/Modal'
import {
  adjustStoreCreditAction,
  type AdjustStoreCreditState,
} from '@/app/(staff)/customers/[id]/store-credit-actions'

const INITIAL: AdjustStoreCreditState = {}

/**
 * Owner / manager move on a customer's money. Direction is a choice rather
 * than a sign on the amount — a clerk who types "-50" meaning "50" should
 * not be able to hand out credit by accident.
 */
export default function AdjustStoreCreditModal({
  open,
  onClose,
  customerId,
  customerName,
  balance,
}: {
  open: boolean
  onClose: () => void
  customerId: string
  customerName: string
  balance: number
}) {
  const { t } = useI18n()
  const ta = t.storeCredit.adjust
  const [state, action, pending] = useActionState<
    AdjustStoreCreditState,
    FormData
  >(adjustStoreCreditAction, INITIAL)
  const [direction, setDirection] = useState<'add' | 'remove'>('add')

  useEffect(() => {
    if (state.ok) onClose()
  }, [state.ok, onClose])

  if (!open) return null

  const errorText = state.error
    ? (t.storeCredit.errors as Record<string, string>)[state.error] ??
      t.storeCredit.errors.store_credit_failed
    : null

  return (
    <Modal title={`${ta.title} — ${customerName}`} onClose={onClose}>
      <form action={action} className="space-y-4">
        <input type="hidden" name="customer_id" value={customerId} />

        <p className="text-xs text-muted">{ta.help}</p>
        <p className="font-mono text-sm text-foreground">
          {ta.currentBalance.replace('{amount}', formatMoney(balance))}
        </p>

        {errorText ? (
          <div
            className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger"
            role="alert"
          >
            {errorText}
          </div>
        ) : null}

        <fieldset className="space-y-1">
          <legend className="text-sm font-medium text-foreground">
            {ta.direction}
          </legend>
          <div className="flex gap-2">
            {(['add', 'remove'] as const).map((d) => (
              <label
                key={d}
                className={`flex-1 cursor-pointer rounded-xl border-2 px-3 py-2 text-center text-sm transition-colors ${
                  direction === d
                    ? 'border-gold bg-gold/10 text-foreground'
                    : 'border-border text-muted hover:border-gold/40'
                }`}
              >
                <input
                  type="radio"
                  name="direction"
                  value={d}
                  checked={direction === d}
                  onChange={() => setDirection(d)}
                  className="sr-only"
                />
                {d === 'add' ? ta.add : ta.remove}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="block space-y-1">
          <span className="text-sm font-medium text-foreground">
            {ta.amount}
          </span>
          <input
            type="number"
            name="amount"
            min="0.01"
            step="0.01"
            max={direction === 'remove' ? balance : undefined}
            required
            className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
          />
          {state.fieldErrors?.amount ? (
            <span className="text-xs text-danger">
              {t.storeCredit.errors.store_credit_invalid_amount}
            </span>
          ) : null}
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-medium text-foreground">
            {ta.reason}
          </span>
          <textarea
            name="reason"
            rows={2}
            required
            minLength={5}
            placeholder={ta.reasonPlaceholder}
            className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
          />
        </label>

        <Footer>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border bg-card px-4 py-2 text-sm text-foreground hover:bg-background"
          >
            {t.common.cancel}
          </button>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-gold px-4 py-2 text-sm font-medium text-navy hover:bg-gold-2 disabled:opacity-50"
          >
            {pending ? ta.submitting : ta.submit}
          </button>
        </Footer>
      </form>
    </Modal>
  )
}
