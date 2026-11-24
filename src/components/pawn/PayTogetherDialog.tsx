'use client'

import { useMemo, useState, useTransition } from 'react'
import { CashRegister } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import {
  MAX_EXTENSION_PERIODS,
  addDaysIso,
  daysBetween,
  extensionCostToDate,
  planLoanPayment,
  type ChargeModel,
  type LoanMoneyEvent,
} from '@/lib/pawn/math'
import { amountForPrincipal, moveChoices } from '@/lib/pawn/payment-choices'
import type { PaymentMethod } from '@/types/database-aliases'
import type { PayTogetherResult } from '@/app/(staff)/pawn/[id]/actions'
import { Footer, Modal } from './RecordPaymentDialog'

const usd = (n: number): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num = (s: string): number => parseFloat(s || '0') || 0

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

/** 'p3' = move the due date 3 periods; 'date' = to the date picked;
 *  'payoff' = pay it off; 'none' = do not move the date. */
type Choice = string

type Row = {
  choice: Choice
  /** The day picked when choice = 'date'. */
  date: string | null
  /** Extra toward the loan, on top of the interest. */
  principalStr: string
  amountStr: string
}

/**
 * Several tickets of one customer paid in one visit. Each ticket offers what
 * the single payment dialog offers: how far the payment moves the due date
 * (periods, another date, none, or pay it off), money toward the loan, and
 * the amount. The amount follows the other two and can still be typed.
 * No fee field (Eddy, 2026-11-24: off until which fees Florida allows is
 * settled); the server still takes fees_paid, which is sent as 0.
 * The split and the new date shown are a preview of planLoanPayment — the
 * server plans every ticket again before it writes any
 * (recordPaymentsAction).
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
    payments: Array<{
      loan_id: string
      amount: string
      fees_paid: string
      periods: number
      new_due_date?: string
    }>
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

  const periodsOf = (choice: Choice): number =>
    choice.startsWith('p') ? parseInt(choice.slice(1), 10) || 0 : 0

  /** Interest the move picked costs, as listed (before any paydown). */
  function moveCost(i: number, r: Pick<Row, 'choice' | 'date'>): number {
    if (r.choice === 'date') {
      return r.date && dateOk(i, r.date) ? extensionCostToDate(tickets[i].loan, r.date) : 0
    }
    return menus[i].choices.find((c) => c.periods === periodsOf(r.choice))?.cost ?? 0
  }

  function dateOk(i: number, date: string): boolean {
    const due = tickets[i].loan.dueDate
    const pd = tickets[i].loan.charge.periodDays
    return date >= addDaysIso(due, 1) && date <= addDaysIso(due, MAX_EXTENSION_PERIODS * pd)
  }

  /** The amount that row's choices add up to ('' when nothing is asked). */
  function amountOf(i: number, r: Row): string {
    const tk = tickets[i]
    if (r.choice === 'payoff') return tk.payoff.toFixed(2)
    const toPrincipal = num(r.principalStr)
    const cost = moveCost(i, r)
    if (toPrincipal <= 0) return cost > 0 ? cost.toFixed(2) : ''
    const a = amountForPrincipal({
      ...tk.loan,
      today,
      periods: periodsOf(r.choice),
      newDueDate: r.choice === 'date' ? r.date : null,
      fees: 0,
      toPrincipal,
      startAt: cost,
    })
    return a != null ? a.toFixed(2) : (cost + toPrincipal).toFixed(2)
  }

  // Each ticket opens on the move that brings it current, like the single
  // dialog does.
  const [rows, setRows] = useState<Row[]>(() =>
    menus.map((m) => {
      const c = m.choices[m.startPeriods - 1]
      return { choice: `p${c.periods}`, date: null, principalStr: '', amountStr: c.cost.toFixed(2) }
    }),
  )

  /** Change a row; the amount follows unless the clerk typed it. */
  function update(i: number, patch: Partial<Row>) {
    setRows((rs) =>
      rs.map((r, j) => {
        if (j !== i) return r
        const next = { ...r, ...patch }
        if (next.choice === 'payoff') next.principalStr = ''
        return 'amountStr' in patch ? next : { ...next, amountStr: amountOf(i, next) }
      }),
    )
  }

  function pickChoice(i: number, choice: Choice) {
    if (choice !== 'date') return update(i, { choice, date: null })
    // Start on a period from today — "bring it up to date" — or a period
    // past the due date when that is later (as the single dialog does).
    const tk = tickets[i]
    const pd = tk.loan.charge.periodDays
    const fromToday = addDaysIso(today, pd)
    update(i, { choice, date: fromToday > tk.loan.dueDate ? fromToday : addDaysIso(tk.loan.dueDate, pd) })
  }

  const previews = rows.map((r, i) =>
    planLoanPayment({
      ...tickets[i].loan,
      today,
      periods: periodsOf(r.choice),
      newDueDate: r.choice === 'date' ? r.date : null,
      amount: num(r.amountStr),
      fees: 0,
    }),
  )
  const amounts = rows.map((r) => num(r.amountStr))
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
          fees_paid: '0',
          periods: periodsOf(r.choice),
          ...(r.choice === 'date' && r.date ? { new_due_date: r.date } : {}),
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
  const LABEL = 'text-xs font-medium text-foreground'

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
          const due = tk.loan.dueDate
          const pd = tk.loan.charge.periodDays
          return (
            <div key={tk.id} className="rounded-xl border border-border p-3">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-mono text-sm font-bold text-navy">{tk.ticket_number}</span>
                <span className="text-xs text-muted">
                  {tt.dueLabel.replace('{date}', due)} ·{' '}
                  {tt.payoffLabel.replace('{amount}', `$${usd(tk.payoff)}`)}
                </span>
              </div>

              <select
                value={r.choice}
                onChange={(e) => pickChoice(i, e.target.value)}
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
                <option value="date">{tp.moveToDate}</option>
                <option value="payoff">{tt.payOff.replace('{amount}', `$${usd(tk.payoff)}`)}</option>
                <option value="none">{tp.moveNone.replace('{date}', due)}</option>
              </select>
              {r.choice === 'date' ? (
                <span className="mt-2 flex flex-wrap items-center gap-3">
                  <input
                    type="date"
                    aria-label={tp.newDueDate}
                    value={r.date ?? ''}
                    min={addDaysIso(due, 1)}
                    max={addDaysIso(due, MAX_EXTENSION_PERIODS * pd)}
                    onChange={(e) => update(i, { date: e.target.value })}
                    className={`${INPUT} max-w-[14rem]`}
                  />
                  {r.date && dateOk(i, r.date) ? (
                    <span className="text-sm text-foreground">
                      {tp.moveToDateCost
                        .replace('{days}', String(daysBetween(due, r.date)))
                        .replace('{cost}', usd(moveCost(i, r)))}
                    </span>
                  ) : null}
                </span>
              ) : null}

              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="block space-y-1">
                  <span className={LABEL}>{tt.towardPrincipal}</span>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    placeholder="0.00"
                    disabled={r.choice === 'payoff'}
                    value={r.principalStr}
                    onChange={(e) => update(i, { principalStr: e.target.value })}
                    className={`${INPUT} font-mono disabled:opacity-50`}
                  />
                </label>
                <label className="block space-y-1">
                  <span className={LABEL}>{tp.amount}</span>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    value={r.amountStr}
                    onChange={(e) => update(i, { amountStr: e.target.value })}
                    className={`${INPUT} font-mono font-bold`}
                  />
                </label>
              </div>

              <div className="mt-1.5 text-xs">
                {r.choice === 'date' && r.date && !dateOk(i, r.date) ? (
                  <span className="text-danger">{reason('bad_due_date', i)}</span>
                ) : amounts[i] > 0 && !p.ok ? (
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
                        {tp.dueAfter}: <span className="font-mono">{p.new_due_date ?? due}</span>
                        {(p.new_due_date ?? due) < today ? (
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
