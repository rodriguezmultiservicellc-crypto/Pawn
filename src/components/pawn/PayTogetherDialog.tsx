'use client'

import { useMemo, useState, useTransition } from 'react'
import { CashRegister } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { planLoanPayment, type ChargeModel, type LoanMoneyEvent } from '@/lib/pawn/math'
import { moveChoices } from '@/lib/pawn/payment-choices'
import type { PaymentMethod } from '@/types/database-aliases'
import type { PayTogetherResult } from '@/app/(staff)/pawn/[id]/actions'
import { Footer, Modal } from './RecordPaymentDialog'

const usd = (n: number): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export type PayTogetherTicket = {
  id: string
  ticket_number: string
  /** Full payoff today, as the list figured it. */
  payoff: number
  loan: {
    principal: number
    monthlyRate: number
    minMonthlyCharge: number | null
    issueDate: string
    dueDate: string
    events: ReadonlyArray<LoanMoneyEvent>
    charge: ChargeModel
  }
}

/** 'p3' = move the due date 3 periods; 'payoff' = pay it off; 'none' = an
 *  amount that does not move the date. */
type Choice = string

/**
 * Several tickets of one customer paid in one visit. Each row is what the
 * single payment dialog offers in short: how far the payment moves the due
 * date (or pay it off), and the amount. The split and the new date shown
 * are a preview of planLoanPayment — the server plans every ticket again
 * before it writes any (recordPaymentsAction).
 */
export function PayTogetherDialog({
  tickets,
  customerName,
  today,
  onClose,
  onSubmit,
  onDone,
}: {
  tickets: PayTogetherTicket[]
  customerName: string
  today: string
  onClose: () => void
  onSubmit: (input: {
    payments: Array<{ loan_id: string; amount: string; periods: number }>
    payment_method: PaymentMethod
    notes: string
  }) => Promise<PayTogetherResult>
  /** Every ticket was paid: the receipt is offered for this group. */
  onDone: (groupId: string, total: number) => void
}) {
  const { t } = useI18n()
  const tp = t.pawn.payment
  const tt = t.pawn.payTogether
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [notes, setNotes] = useState('')

  const menus = useMemo(
    () => tickets.map((tk) => moveChoices(tk.loan, today, tk.payoff)),
    [tickets, today],
  )
  // Each ticket opens on the move that brings it current, like the single
  // dialog does.
  const [rows, setRows] = useState<Array<{ choice: Choice; amountStr: string }>>(() =>
    menus.map((m) => {
      const c = m.choices[m.startPeriods - 1]
      return { choice: `p${c.periods}`, amountStr: c.cost.toFixed(2) }
    }),
  )

  function pick(i: number, choice: Choice) {
    const tk = tickets[i]
    const m = menus[i]
    const amountStr =
      choice === 'payoff'
        ? tk.payoff.toFixed(2)
        : choice === 'none'
        ? ''
        : (m.choices.find((c) => `p${c.periods}` === choice)?.cost ?? 0).toFixed(2)
    setRows((rs) => rs.map((r, j) => (j === i ? { choice, amountStr } : r)))
  }

  function setAmount(i: number, amountStr: string) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, amountStr } : r)))
  }

  const periodsOf = (choice: Choice): number =>
    choice.startsWith('p') ? parseInt(choice.slice(1), 10) || 0 : 0

  const previews = rows.map((r, i) =>
    planLoanPayment({
      ...tickets[i].loan,
      today,
      periods: periodsOf(r.choice),
      newDueDate: null,
      amount: parseFloat(r.amountStr || '0') || 0,
      fees: 0,
    }),
  )
  const amounts = rows.map((r) => parseFloat(r.amountStr || '0') || 0)
  const total = Math.round(amounts.reduce((s, a) => s + a, 0) * 100) / 100
  const allOk = previews.every((p, i) => p.ok && amounts[i] > 0)

  function reason(code: string, i: number): string {
    const known = tp.errors as Record<string, string>
    const [key, arg] = code.split(':')
    return (known[key] ?? known.generic)
      .replace('{payoff}', tickets[i].payoff.toFixed(2))
      .replace('{date}', tickets[i].loan.dueDate)
      .replace('{needed}', arg ?? '')
  }

  function submit() {
    setError(null)
    startTransition(async () => {
      const res = await onSubmit({
        payments: rows.map((r, i) => ({
          loan_id: tickets[i].id,
          amount: r.amountStr,
          periods: periodsOf(r.choice),
        })),
        payment_method: method,
        notes,
      })
      if (res.ok && res.groupId) {
        onDone(res.groupId, total)
        return
      }
      const te = tt.errors as Record<string, string>
      if (res.refused) {
        const i = tickets.findIndex((tk) => tk.id === res.refused!.loanId)
        setError(
          tt.refused
            .replace('{ticket}', i >= 0 ? tickets[i].ticket_number : '?')
            .replace('{reason}', reason(res.refused.error, Math.max(0, i))),
        )
      } else if (res.error === 'partly_saved') {
        const paid = tickets
          .filter((tk) => res.savedLoanIds?.includes(tk.id))
          .map((tk) => tk.ticket_number)
          .join(', ')
        setError(te.partly_saved.replace('{tickets}', paid || '—'))
      } else {
        setError(te[res.error ?? ''] ?? te.generic)
      }
    })
  }

  const INPUT =
    'block w-full rounded-xl border-2 border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-blue'

  return (
    <Modal title={tt.title} onClose={onClose} wide>
      <p className="-mt-2 mb-1 font-mono text-sm font-semibold text-navy">
        {tt.subtitle.replace('{name}', customerName).replace('{count}', String(tickets.length))}
      </p>
      <p className="mb-3 text-xs text-muted">{tt.help}</p>
      {error ? (
        <div className="mb-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}

      <div className="space-y-3">
        {tickets.map((tk, i) => {
          const r = rows[i]
          const p = previews[i]
          return (
            <div key={tk.id} className="rounded-xl border border-border p-3">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-mono text-sm font-bold text-navy">{tk.ticket_number}</span>
                <span className="text-xs text-muted">
                  {tt.dueLabel.replace('{date}', tk.loan.dueDate)} ·{' '}
                  {tt.payoffLabel.replace('{amount}', `$${usd(tk.payoff)}`)}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_9rem]">
                <select
                  value={r.choice}
                  onChange={(e) => pick(i, e.target.value)}
                  aria-label={tp.moveDueDate}
                  className={INPUT}
                >
                  {menus[i].choices.map((c) => (
                    <option key={c.periods} value={`p${c.periods}`}>
                      {tp.moveOption
                        .replace('{days}', String(c.days))
                        .replace('{date}', c.due)
                        .replace('{cost}', usd(c.cost))}
                    </option>
                  ))}
                  <option value="payoff">{tt.payOff.replace('{amount}', `$${usd(tk.payoff)}`)}</option>
                  <option value="none">{tp.moveNone.replace('{date}', tk.loan.dueDate)}</option>
                </select>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  value={r.amountStr}
                  onChange={(e) => setAmount(i, e.target.value)}
                  aria-label={tp.amount}
                  className={`${INPUT} font-mono`}
                />
              </div>
              <div className="mt-1.5 text-xs">
                {amounts[i] > 0 && !p.ok ? (
                  <span className="text-danger">{reason(p.reason, i)}</span>
                ) : amounts[i] > 0 && p.ok ? (
                  <span className="text-foreground">
                    {p.closes ? (
                      <span className="font-medium text-success">{tp.closesLoan}</span>
                    ) : (
                      <>
                        {tt.split
                          .replace('{interest}', `$${usd(p.interest_paid)}`)
                          .replace('{principal}', `$${usd(p.principal_paid)}`)}
                        {' · '}
                        {tp.dueAfter}: <span className="font-mono">{p.new_due_date ?? tk.loan.dueDate}</span>
                        {(p.new_due_date ?? tk.loan.dueDate) < today ? (
                          <span className="ml-1 font-semibold text-danger">{tp.stillPastDue}</span>
                        ) : null}
                      </>
                    )}
                  </span>
                ) : null}
              </div>
            </div>
          )
        })}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-sm font-medium text-foreground">{tp.paymentMethod}</span>
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
          <div className="flex items-end justify-between rounded-xl bg-background px-4 py-2">
            <span className="text-sm font-semibold text-foreground">{tt.total}</span>
            <span className="font-mono text-xl font-bold text-navy">${usd(total)}</span>
          </div>
        </div>

        <label className="block space-y-1">
          <span className="text-sm font-medium text-foreground">{t.pawn.new_.notes}</span>
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={INPUT} />
        </label>
      </div>

      <Footer>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-border bg-card px-4 py-2 text-sm text-foreground hover:bg-background"
        >
          {t.common.cancel}
        </button>
        <button
          type="button"
          disabled={pending || !allOk}
          onClick={submit}
          className="inline-flex items-center gap-1 rounded-md bg-gold px-4 py-2 text-sm font-medium text-navy hover:bg-gold-2 disabled:opacity-50"
        >
          <CashRegister size={14} weight="bold" />
          {pending ? tt.submitting : tt.submit.replace('{amount}', `$${usd(total)}`)}
        </button>
      </Footer>
    </Modal>
  )
}
