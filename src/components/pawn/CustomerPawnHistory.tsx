'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CaretDown, ClockCounterClockwise } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { formatMoney, shortDate } from '@/lib/format/money'
import type { CustomerPawnHistory as History, HistoryOutcome } from '@/lib/pawn/customer-history'

const OUTCOME_TONE: Record<HistoryOutcome, string> = {
  open: 'border-info/30 bg-info/5 text-info',
  redeemed: 'border-success/30 bg-success/5 text-success',
  forfeited: 'border-danger/30 bg-danger/5 text-danger',
  voided: 'border-border bg-background text-muted',
}

/**
 * What this customer has done with the shop before, at the top of the new
 * ticket: how many tickets, how many they picked up, how many they lost,
 * what is on loan now — and, on demand, the recent tickets with their pieces.
 *
 * Read-only. `history` null = still loading (or no customer picked — the
 * parent does not render the panel then).
 */
export function CustomerPawnHistory({
  customerId,
  history,
  failed,
}: {
  customerId: string
  history: History | null
  failed: boolean
}) {
  const { t } = useI18n()
  const h = t.pawn.new_.history
  const [open, setOpen] = useState(false)

  const shell = 'min-w-0 flex-1 rounded-xl border border-border bg-card px-4 py-3'
  if (failed) return <div className={`${shell} text-sm text-danger`}>{h.failed}</div>
  if (!history) return <div className={`${shell} text-sm text-muted`}>{h.loading}</div>
  if (history.total === 0 && history.voided === 0) {
    return <div className={`${shell} text-sm text-muted`}>{h.none}</div>
  }

  const stat = (label: string, value: string, tone = 'text-foreground') => (
    <div className="min-w-16">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className={`font-mono text-lg font-bold ${tone}`}>{value}</div>
    </div>
  )

  return (
    <div className={shell}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ClockCounterClockwise size={18} weight="regular" />
          {h.title}
        </div>
        {stat(h.pawned, String(history.total))}
        {stat(h.pickedUp, String(history.redeemed), 'text-success')}
        {stat(h.lost, String(history.forfeited), history.forfeited > 0 ? 'text-danger' : 'text-foreground')}
        {stat(h.open, String(history.open))}
        {history.open > 0 ? stat(h.onLoan, formatMoney(history.open_principal)) : null}
        <div className="ml-auto flex items-center gap-3">
          {history.first_date ? (
            <span className="text-xs text-muted">{h.since.replace('{date}', shortDate(history.first_date))}</span>
          ) : null}
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex h-9 items-center gap-1 rounded-xl border border-border bg-card px-3 text-xs font-semibold text-foreground hover:bg-background"
          >
            {open ? h.hide : h.show}
            <CaretDown size={12} weight="bold" className={`transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {open ? (
        <div className="mt-3 border-t border-border pt-3">
          <ul className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {history.recent.map((r) => (
              <li key={r.loan_id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                <Link
                  href={`/pawn/${r.loan_id}`}
                  target="_blank"
                  className="font-mono font-semibold text-blue hover:underline"
                >
                  {r.ticket_number}
                </Link>
                <span className="font-mono text-xs text-muted">{shortDate(r.issue_date)}</span>
                <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${OUTCOME_TONE[r.outcome]}`}>
                  {h.outcome[r.outcome]}
                </span>
                <span className="font-mono text-xs text-foreground">{formatMoney(r.principal)}</span>
                <span className="min-w-0 flex-1 text-xs text-text-secondary">{r.items.join(' · ') || '—'}</span>
              </li>
            ))}
          </ul>
          <Link
            href={`/pawn?customer=${customerId}&status=all`}
            target="_blank"
            className="mt-3 inline-block text-xs font-semibold text-blue hover:underline"
          >
            {h.all.replace('{n}', String(history.total + history.voided))}
          </Link>
        </div>
      ) : null}
    </div>
  )
}
