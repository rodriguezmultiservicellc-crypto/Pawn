'use client'

import { useMemo, useState, useTransition } from 'react'
import { CashRegister, X } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { allocateLoanPayment } from '@/lib/pawn/math'
import type { PaymentMethod } from '@/types/database-aliases'

/**
 * Dialog for recording a payment against a loan.
 *
 * The clerk enters the amount collected and, optionally, how much of it is
 * a fee. How the rest is applied (interest first, then principal) is shown
 * as a read-only preview — the SERVER decides the real split from the
 * payoff it reads itself (recordPaymentAction → allocateLoanPayment), so
 * there is no way to pay principal down while interest is still owed.
 */
export function RecordPaymentDialog({
  loanId,
  payoff,
  outstandingInterest,
  onClose,
  onSubmit,
}: {
  loanId: string
  /** Current full-payoff value for the prefill (cash redemption). */
  payoff: number
  /** Current accrued-but-unpaid interest, used by the preview. */
  outstandingInterest: number
  onClose: () => void
  onSubmit: (
    formData: FormData,
  ) => Promise<{ error?: string; ok?: boolean }>
}) {
  const { t } = useI18n()
  const tp = t.pawn.payment
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [amountStr, setAmountStr] = useState<string>(payoff.toFixed(2))
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [feesStr, setFeesStr] = useState<string>('')
  const [notes, setNotes] = useState<string>('')

  const amount = parseFloat(amountStr || '0') || 0
  const fees = parseFloat(feesStr || '0') || 0

  // Preview only — same function the server uses, same inputs the page was
  // rendered with. The server recomputes against live data on submit.
  const preview = useMemo(
    () =>
      allocateLoanPayment({
        amount,
        fees,
        interestOutstanding: outstandingInterest,
        principalOutstanding: Math.max(0, payoff - outstandingInterest),
      }),
    [amount, fees, outstandingInterest, payoff],
  )

  function translateError(code: string): string {
    const known = tp.errors as Record<string, string>
    return (known[code] ?? known.generic).replace('{payoff}', payoff.toFixed(2))
  }

  function submit() {
    setError(null)
    const fd = new FormData()
    fd.set('loan_id', loanId)
    fd.set('amount', amountStr)
    fd.set('payment_method', method)
    fd.set('fees_paid', feesStr || '0')
    if (notes) fd.set('notes', notes)
    startTransition(async () => {
      const res = await onSubmit(fd)
      if (res.error) setError(translateError(res.error))
      else onClose()
    })
  }

  const previewError =
    amount > 0 && !preview.ok ? translateError(preview.reason) : null

  return (
    <Modal title={tp.title} onClose={onClose}>
      {error ? (
        <div className="mb-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-sm font-medium text-foreground">
              {tp.amount}
            </span>
            <input
              type="number"
              step="0.01"
              min={0}
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-foreground">
              {tp.paymentMethod}
            </span>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethod)}
              className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
            >
              <option value="cash">{tp.methodCash}</option>
              <option value="card">{tp.methodCard}</option>
              <option value="check">{tp.methodCheck}</option>
              <option value="other">{tp.methodOther}</option>
            </select>
          </label>
        </div>

        <div className="rounded-md border border-border bg-background/40 p-3">
          <div className="mb-1 text-xs font-semibold text-foreground">
            {tp.splitTitle}
          </div>
          <p className="mb-2 text-xs text-muted">{tp.splitTooltip}</p>
          <div className="grid grid-cols-3 gap-2">
            <SplitField
              label={tp.feesPaid}
              value={feesStr}
              onChange={setFeesStr}
              placeholder="0.00"
            />
            <SplitField
              label={tp.interestPaid}
              value={preview.ok ? preview.interest_paid.toFixed(2) : '—'}
              readOnly
            />
            <SplitField
              label={tp.principalPaid}
              value={preview.ok ? preview.principal_paid.toFixed(2) : '—'}
              readOnly
            />
          </div>
          {previewError ? (
            <div className="mt-2 text-xs text-danger">{previewError}</div>
          ) : null}
        </div>

        <label className="block space-y-1">
          <span className="text-sm font-medium text-foreground">
            {t.pawn.new_.notes}
          </span>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
          />
        </label>
      </div>

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
          disabled={pending || !preview.ok || !(amount > 0)}
          onClick={submit}
          className="inline-flex items-center gap-1 rounded-md bg-gold px-4 py-2 text-sm text-navy font-medium hover:bg-gold-2 disabled:opacity-50"
        >
          <CashRegister size={14} weight="bold" />
          {pending ? tp.submitting : tp.submit}
        </button>
      </Footer>
    </Modal>
  )
}

function SplitField({
  label,
  value,
  onChange,
  readOnly,
  placeholder,
}: {
  label: string
  value: string
  onChange?: (v: string) => void
  readOnly?: boolean
  placeholder?: string
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-foreground">{label}</span>
      <input
        type={readOnly ? 'text' : 'number'}
        step="0.01"
        min={0}
        value={value}
        readOnly={readOnly}
        placeholder={placeholder}
        onChange={(e) => onChange?.(e.target.value)}
        className={`block w-full rounded-md border bg-card px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-blue/10 ${
          readOnly
            ? 'border-border bg-background/60 text-muted'
            : 'border-border focus:border-blue'
        }`}
      />
    </label>
  )
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-lg">
        <header className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted hover:bg-background hover:text-foreground"
            aria-label="close"
          >
            <X size={16} weight="bold" />
          </button>
        </header>
        {children}
      </div>
    </div>
  )
}

export function Footer({ children }: { children: React.ReactNode }) {
  return <div className="mt-5 flex items-center justify-end gap-2">{children}</div>
}
