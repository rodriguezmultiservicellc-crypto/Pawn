'use client'

import { useState, useTransition } from 'react'
import { CheckCircle } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { Modal, Footer } from './RecordPaymentDialog'
import type { PaymentMethod } from '@/types/database-aliases'

/**
 * Small dialog for confirming a full redemption. Records a payment for the
 * current full payoff (interest + principal outstanding) and flips the loan
 * to status='redeemed'. The server action computes the actual splits — this
 * dialog only collects the payment method.
 */
export function RedeemConfirmDialog({
  loanId,
  payoff,
  onClose,
  onSubmit,
}: {
  loanId: string
  payoff: number
  onClose: () => void
  onSubmit: (
    formData: FormData,
  ) => Promise<{ error?: string; ok?: boolean }>
}) {
  const { t } = useI18n()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [method, setMethod] = useState<PaymentMethod>('cash')

  function submit() {
    setError(null)
    const fd = new FormData()
    fd.set('loan_id', loanId)
    fd.set('payment_method', method)
    startTransition(async () => {
      const res = await onSubmit(fd)
      if (res.error) setError(res.error)
      else onClose()
    })
  }

  return (
    <Modal title={t.pawn.redeem.title} onClose={onClose}>
      {error ? (
        <div className="mb-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}

      <p className="mb-3 text-sm text-foreground">{t.pawn.redeem.bodyHelp}</p>

      <div className="mb-4 flex items-center justify-between rounded-md border border-gold/30 bg-gold/5 px-3 py-2">
        <span className="text-sm font-semibold text-foreground">
          {t.pawn.redeem.payoffNow}
        </span>
        <span className="font-mono text-xl font-semibold text-gold">
          {payoff.toLocaleString('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 2,
          })}
        </span>
      </div>

      <label className="block space-y-1">
        <span className="text-sm font-medium text-foreground">
          {t.pawn.redeem.paymentMethod}
        </span>
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value as PaymentMethod)}
          className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
        >
          <option value="cash">{t.pawn.payment.methodCash}</option>
          <option value="card">{t.pawn.payment.methodCard}</option>
          <option value="check">{t.pawn.payment.methodCheck}</option>
          <option value="other">{t.pawn.payment.methodOther}</option>
        </select>
      </label>

      <Footer>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-border bg-card px-4 py-2 text-sm text-foreground hover:bg-background hover:text-foreground"
        >
          {t.common.cancel}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={submit}
          className="inline-flex items-center gap-1 rounded-md bg-success px-4 py-2 text-sm text-white font-medium hover:opacity-90 disabled:opacity-50"
        >
          <CheckCircle size={14} weight="bold" />
          {pending ? t.pawn.redeem.submitting : t.pawn.redeem.submit}
        </button>
      </Footer>
    </Modal>
  )
}
