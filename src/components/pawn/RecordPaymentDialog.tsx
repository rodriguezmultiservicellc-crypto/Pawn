'use client'

import { useMemo, useState, useTransition } from 'react'
import { CalendarCheck, CashRegister, X } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import {
  addDaysIso,
  extensionCost,
  periodsToBringCurrent,
  planLoanPayment,
} from '@/lib/pawn/math'
import type { PaymentMethod } from '@/types/database-aliases'

/** How many periods the dialog offers. The server accepts more. */
const PERIOD_CHOICES = 6

/** "1,086.00" — the dictionary string carries the "$". */
const usd = (n: number): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

type DialogLoan = {
  principal: number
  monthlyRate: number
  minMonthlyCharge: number | null
  issueDate: string
  /** The loan's current due date — a move is counted from here. */
  dueDate: string
  events: ReadonlyArray<{
    principal_paid: number
    interest_paid: number
    fees_paid: number
  }>
  /** Days in one period (the jurisdiction's). */
  periodDays: number
}

/**
 * Dialog for taking a payment on a loan — which is also how a loan is
 * extended. The clerk picks how far the payment moves the due date (not at
 * all, one period, two…) and the amount collected; optionally how much of
 * it is a fee.
 *
 * Everything else is a read-only preview of `planLoanPayment`, the same
 * function the SERVER runs against the payoff it reads itself
 * (recordPaymentAction): interest first, then principal, and a due date
 * counted from the OLD due date that only moves when its interest is paid.
 */
export function RecordPaymentDialog({
  loanId,
  loan,
  today,
  payoff,
  onClose,
  onSubmit,
}: {
  loanId: string
  loan: DialogLoan
  /** The shop's day — the same one the server will use. */
  today: string
  /** Current full-payoff value, for the "more than is owed" message. */
  payoff: number
  onClose: () => void
  onSubmit: (
    formData: FormData,
  ) => Promise<{ error?: string; ok?: boolean }>
}) {
  const { t } = useI18n()
  const tp = t.pawn.payment
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // What each choice costs and where it leaves the due date.
  const choices = useMemo(
    () =>
      Array.from({ length: PERIOD_CHOICES }, (_, i) => {
        const periods = i + 1
        return {
          periods,
          days: periods * loan.periodDays,
          cost: extensionCost(loan, periods),
          due: addDaysIso(loan.dueDate, periods * loan.periodDays),
        }
      }),
    [loan],
  )
  // Open on the move that brings the ticket current: one period for a
  // customer on time, more for one who is late.
  const startPeriods = Math.min(
    PERIOD_CHOICES,
    periodsToBringCurrent(loan.dueDate, today, loan.periodDays),
  )
  const [periods, setPeriods] = useState<number>(startPeriods)
  const [amountStr, setAmountStr] = useState<string>(
    choices[startPeriods - 1].cost.toFixed(2),
  )
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [feesStr, setFeesStr] = useState<string>('')
  const [notes, setNotes] = useState<string>('')

  const amount = parseFloat(amountStr || '0') || 0
  const fees = parseFloat(feesStr || '0') || 0

  function pickPeriods(next: number) {
    setPeriods(next)
    // The amount follows the choice: the interest that move takes, plus any
    // fee already entered. "Do not move it" leaves the amount to the clerk.
    setAmountStr(next > 0 ? (choices[next - 1].cost + fees).toFixed(2) : '')
  }

  // Preview only — same function the server uses, same inputs the page was
  // rendered with. The server recomputes against live data on submit.
  const preview = useMemo(
    () => planLoanPayment({ ...loan, today, periods, amount, fees }),
    [loan, today, periods, amount, fees],
  )

  function translateError(code: string, needed?: number): string {
    const known = tp.errors as Record<string, string>
    // The server sends "extension_underpaid:250.00".
    const [key, arg] = code.split(':')
    return (known[key] ?? known.generic)
      .replace('{payoff}', payoff.toFixed(2))
      .replace('{needed}', needed != null ? needed.toFixed(2) : (arg ?? ''))
  }

  function submit() {
    setError(null)
    const fd = new FormData()
    fd.set('loan_id', loanId)
    fd.set('amount', amountStr)
    fd.set('periods', String(periods))
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
    amount > 0 && !preview.ok
      ? translateError(preview.reason, preview.needed)
      : null

  const INPUT =
    'block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue'

  return (
    <Modal title={tp.title} onClose={onClose}>
      {error ? (
        <div className="mb-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}

      <div className="space-y-4">
        <label className="block space-y-1">
          <span className="text-sm font-medium text-foreground">
            {tp.moveDueDate}
          </span>
          <select
            value={periods}
            onChange={(e) => pickPeriods(parseInt(e.target.value, 10) || 0)}
            className={INPUT}
          >
            {choices.map((c) => (
              <option key={c.periods} value={c.periods}>
                {tp.moveOption
                  .replace('{days}', String(c.days))
                  .replace('{date}', c.due)
                  .replace('{cost}', usd(c.cost))}
              </option>
            ))}
            <option value={0}>
              {tp.moveNone.replace('{date}', loan.dueDate)}
            </option>
          </select>
          <span className="block text-xs text-muted">
            {tp.moveHelp.replace('{date}', loan.dueDate)}
          </span>
        </label>

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
              className={INPUT}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-foreground">
              {tp.paymentMethod}
            </span>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethod)}
              className={INPUT}
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

        {/* What the ticket looks like after this payment. */}
        {amount > 0 && preview.ok ? (
          <div className="rounded-md border border-border bg-background/40 p-3 text-sm">
            {preview.closes ? (
              <p className="font-medium text-success">{tp.closesLoan}</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 text-foreground">
                  <CalendarCheck size={14} weight="bold" />
                  <span className="font-medium">{tp.dueAfter}:</span>
                  <span className="font-mono">
                    {preview.new_due_date ?? loan.dueDate}
                  </span>
                  {preview.new_due_date ? (
                    <span className="text-xs text-muted">
                      {tp.dueWas.replace('{date}', loan.dueDate)}
                    </span>
                  ) : null}
                </div>
                {(preview.new_due_date ?? loan.dueDate) < today ? (
                  <p className="mt-1 text-xs font-semibold text-danger">
                    {tp.stillPastDue}
                  </p>
                ) : null}
              </>
            )}
          </div>
        ) : null}

        <label className="block space-y-1">
          <span className="text-sm font-medium text-foreground">
            {t.pawn.new_.notes}
          </span>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={INPUT}
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
