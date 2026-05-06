'use client'

import { useMemo, useState, useTransition } from 'react'
import { CashRegister, X } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { splitPayment, r4 } from '@/lib/pawn/math'
import type { PaymentMethod } from '@/types/database-aliases'

/**
 * Dialog for recording a payment against a loan. Auto-splits the amount
 * (interest first) by default; "Manual split" override lets the clerk set
 * principal / interest / fees explicitly. The server action re-validates
 * the split totals.
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
  /** Current accrued-but-unpaid interest, used by auto-split. */
  outstandingInterest: number
  onClose: () => void
  onSubmit: (
    formData: FormData,
  ) => Promise<{ error?: string; ok?: boolean }>
}) {
  const { t } = useI18n()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [amountStr, setAmountStr] = useState<string>(payoff.toFixed(2))
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [manual, setManual] = useState(false)
  const [principalStr, setPrincipalStr] = useState<string>('0')
  const [interestStr, setInterestStr] = useState<string>('0')
  const [feesStr, setFeesStr] = useState<string>('0')
  const [notes, setNotes] = useState<string>('')

  const autoSplit = useMemo(() => {
    const a = parseFloat(amountStr || '0')
    return splitPayment(isNaN(a) ? 0 : a, outstandingInterest)
  }, [amountStr, outstandingInterest])

  const interestDisplay = manual ? interestStr : autoSplit.interest_paid.toFixed(2)
  const principalDisplay = manual ? principalStr : autoSplit.principal_paid.toFixed(2)
  const feesDisplay = manual ? feesStr : '0'

  function toggleManual() {
    if (!manual) {
      setInterestStr(autoSplit.interest_paid.toFixed(2))
      setPrincipalStr(autoSplit.principal_paid.toFixed(2))
      setFeesStr('0')
    }
    setManual((v) => !v)
  }

  function submit() {
    setError(null)
    const fd = new FormData()
    fd.set('loan_id', loanId)
    fd.set('amount', amountStr)
    fd.set('payment_method', method)
    fd.set('principal_paid', principalDisplay)
    fd.set('interest_paid', interestDisplay)
    fd.set('fees_paid', feesDisplay)
    if (notes) fd.set('notes', notes)
    startTransition(async () => {
      const res = await onSubmit(fd)
      if (res.error) setError(res.error)
      else onClose()
    })
  }

  const amount = parseFloat(amountStr || '0')
  const splitSum =
    parseFloat(principalDisplay || '0') +
    parseFloat(interestDisplay || '0') +
    parseFloat(feesDisplay || '0')
  const splitMismatch = manual && Math.abs(r4(splitSum) - r4(amount)) > 0.0001

  return (
    <Modal title={t.pawn.payment.title} onClose={onClose}>
      {error ? (
        <div className="mb-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-sm font-medium text-foreground">
              {t.pawn.payment.amount}
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
              {t.pawn.payment.paymentMethod}
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
        </div>

        <div className="rounded-md border border-border bg-background/40 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground">
              {manual ? t.pawn.payment.manualSplit : t.pawn.payment.autoSplit}
            </span>
            <button
              type="button"
              onClick={toggleManual}
              className="rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground hover:bg-background hover:text-foreground"
            >
              {manual ? t.pawn.payment.autoSplit : t.pawn.payment.manualSplit}
            </button>
          </div>
          <p className="mb-2 text-xs text-muted">{t.pawn.payment.splitTooltip}</p>
          <div className="grid grid-cols-3 gap-2">
            <SplitField
              label={t.pawn.payment.interestPaid}
              value={interestDisplay}
              onChange={setInterestStr}
              readOnly={!manual}
            />
            <SplitField
              label={t.pawn.payment.principalPaid}
              value={principalDisplay}
              onChange={setPrincipalStr}
              readOnly={!manual}
            />
            <SplitField
              label={t.pawn.payment.feesPaid}
              value={feesDisplay}
              onChange={setFeesStr}
              readOnly={!manual}
            />
          </div>
          {splitMismatch ? (
            <div className="mt-2 text-xs text-danger">
              {t.pawn.payment.splitMismatch}
            </div>
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
          disabled={pending || splitMismatch || !(amount > 0)}
          onClick={submit}
          className="inline-flex items-center gap-1 rounded-md bg-gold px-4 py-2 text-sm text-navy font-medium hover:bg-gold-2 disabled:opacity-50"
        >
          <CashRegister size={14} weight="bold" />
          {pending ? t.pawn.payment.submitting : t.pawn.payment.submit}
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
}: {
  label: string
  value: string
  onChange: (v: string) => void
  readOnly?: boolean
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-foreground">{label}</span>
      <input
        type="number"
        step="0.01"
        min={0}
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)}
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
