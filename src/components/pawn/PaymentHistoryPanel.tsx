'use client'

import { useMemo, useState, useTransition } from 'react'
import { Gift, Printer } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { shortDate } from '@/lib/format/money'
import { printHtmlFromUrl } from '@/lib/pos/print-frame'
import { dayInTimezone, type ChargeModel } from '@/lib/pawn/math'
import { buildPaymentHistory } from '@/lib/pawn/payment-history'

type PanelEvent = {
  id: string
  event_type: string
  occurred_at: string
  amount: number | null
  principal_paid: number
  interest_paid: number
  fees_paid: number
  interest_waived: number
  new_due_date: string | null
  previous_due_date: string | null
  reverses_event_id: string | null
  legacy: boolean
}

const usd = (n: number): string =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })

/**
 * The ticket's payments the way the counter draws them for a customer who
 * says "I already paid": the pawn date, then one box per stretch of time
 * with the payment that paid for it, and the stretch not paid yet in red.
 * "Print for customer" prints the same thing as a bilingual page.
 *
 * The layout is lib/pawn/payment-history.buildPaymentHistory — the same
 * function the printed page uses.
 */
export function PaymentHistoryPanel({
  loanId,
  issueDate,
  dueDate,
  termDays,
  principal,
  isOpen,
  today,
  interestOwed,
  charge,
  events,
}: {
  loanId: string
  issueDate: string
  dueDate: string
  termDays: number
  principal: number
  isOpen: boolean
  /** The shop's day. */
  today: string
  /** Interest owed as of today; null on a closed ticket. */
  interestOwed: number | null
  charge: ChargeModel
  events: ReadonlyArray<PanelEvent>
}) {
  const { t } = useI18n()
  const th = t.pawn.detail.history
  const [printing, startPrint] = useTransition()
  const [printError, setPrintError] = useState<string | null>(null)

  const history = useMemo(
    () =>
      buildPaymentHistory({
        issueDate,
        dueDate,
        termDays,
        periodDays: charge.periodDays,
        isOpen,
        events: events.map((e) => ({ ...e, legacy_ref: e.legacy ? 'legacy' : null })),
      }),
    [issueDate, dueDate, termDays, charge.periodDays, isOpen, events],
  )
  const paidDay = (instant: string) => shortDate(dayInTimezone(instant, charge.timezone))
  const overdue = isOpen && dueDate < today

  function print() {
    setPrintError(null)
    startPrint(async () => {
      try {
        await printHtmlFromUrl(`/api/print/loan/${loanId}/payments`)
      } catch {
        setPrintError(th.printFailed)
      }
    })
  }

  const BOX = 'min-w-[150px] flex-1 rounded-xl border-2 px-3 py-2'

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{th.title}</h2>
          <p className="mt-0.5 text-xs text-muted">{th.help}</p>
        </div>
        <button
          type="button"
          onClick={print}
          disabled={printing}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-background disabled:opacity-50"
        >
          <Printer size={14} weight="bold" />
          {printing ? th.printing : th.print}
        </button>
      </header>
      {printError ? <p className="mt-2 text-xs text-danger">{printError}</p> : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <div className={`${BOX} max-w-[190px] border-navy/30 bg-navy/5`}>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">{th.pawned}</div>
          <div className="font-mono text-sm font-bold text-navy">{shortDate(history.pawn_date)}</div>
          <div className="font-mono text-xs text-foreground">{usd(principal)}</div>
        </div>

        {history.periods.map((p, i) => (
          <div key={i} className={`${BOX} border-success/40 bg-success/5`}>
            <div className="font-mono text-xs font-semibold text-foreground">
              {shortDate(p.from)} → {shortDate(p.to)}
            </div>
            {p.kind === 'free' ? (
              <div className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-foreground">
                <Gift size={12} weight="bold" />
                {th.free} · {paidDay(p.at)}
              </div>
            ) : (
              <div className="mt-1 text-xs text-muted">
                {p.kind === 'moved' ? th.moved : th.paid} {paidDay(p.at)}
              </div>
            )}
            {p.kind === 'paid' ? (
              <div className="font-mono text-base font-bold text-success">{usd(p.amount)}</div>
            ) : null}
            {p.kind === 'free' ? (
              <div className="font-mono text-sm font-semibold text-foreground">{usd(p.waived)}</div>
            ) : null}
            {p.principal > 0 ? (
              <div className="text-xs text-muted">
                {th.towardLoan}: <span className="font-mono">{usd(p.principal)}</span>
              </div>
            ) : null}
          </div>
        ))}

        {history.open ? (
          <div
            className={`${BOX} ${
              overdue ? 'border-danger bg-danger/5' : 'border-warning bg-warning/5'
            }`}
          >
            <div className="font-mono text-xs font-semibold text-foreground">
              {shortDate(history.open.from)} → {shortDate(history.open.to)}
            </div>
            <div
              className={`mt-1 text-sm font-bold uppercase ${overdue ? 'text-danger' : 'text-warning'}`}
            >
              {th.notPaid}
            </div>
            {interestOwed != null && interestOwed > 0 ? (
              <div className="text-xs text-foreground">
                {th.owedToday}: <span className="font-mono font-semibold">{usd(interestOwed)}</span>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {history.periods.length === 0 && history.open ? (
        <p className="mt-2 text-xs text-muted">{th.nonePaid}</p>
      ) : null}

      {history.other.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{th.other}</h3>
          <ul className="mt-1 divide-y divide-border text-sm">
            {history.other.map((o, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-1.5">
                <span className="font-mono text-xs text-foreground">{paidDay(o.at)}</span>
                <span className="flex-1 text-xs text-muted">
                  {o.payoff ? th.payoff : o.principal > 0 ? th.towardLoan : th.interest}
                </span>
                <span className="font-mono font-semibold text-foreground">{usd(o.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-3 flex items-center justify-between border-t border-border pt-2 text-sm">
        <span className="text-muted">{th.totalPaid}</span>
        <span className="font-mono font-bold text-foreground">{usd(history.total_paid)}</span>
      </div>
    </section>
  )
}
