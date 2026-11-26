'use client'

import { ClockCounterClockwise } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { formatMoney, shortDate } from '@/lib/format/money'
import { CustomerHistoryCard } from '@/components/customers/CustomerHistoryCard'
import type { CustomerPawnHistory as History, HistoryOutcome } from '@/lib/pawn/customer-history'

const OUTCOME_TONE: Record<HistoryOutcome, string> = {
  open: 'border-info/30 bg-info/5 text-info',
  redeemed: 'border-success/30 bg-success/5 text-success',
  forfeited: 'border-danger/30 bg-danger/5 text-danger',
  voided: 'border-border bg-background text-muted',
}
/** Solid, so it does not read as "Lost" (outlined red). */
const OVERDUE_TONE = 'border-danger bg-danger font-bold text-white'

/**
 * What this customer has done with the shop before, beside them on the new
 * ticket: how many tickets, how many they picked up, how many they lost,
 * what is on loan now — and, on demand, the recent tickets with their pieces.
 * Drawn by the shared CustomerHistoryCard (Repair history, Purchases too).
 *
 * Read-only. `history` null = still loading. The form loads it (not this
 * card) because "Pawned before" reads it too.
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

  const state = failed
    ? 'failed'
    : !history
      ? 'loading'
      : history.total === 0 && history.voided === 0
        ? 'empty'
        : 'ready'

  return (
    <CustomerHistoryCard
      state={state}
      icon={<ClockCounterClockwise size={18} weight="regular" />}
      title={h.title}
      text={h}
      stats={
        history
          ? [
              { label: h.pawned, value: String(history.total) },
              { label: h.pickedUp, value: String(history.redeemed), tone: 'text-success' },
              {
                label: h.lost,
                value: String(history.forfeited),
                tone: history.forfeited > 0 ? 'text-danger' : undefined,
              },
              { label: h.open, value: String(history.open) },
              ...(history.overdue > 0
                ? [{ label: h.overdue, value: String(history.overdue), tone: 'text-danger' }]
                : []),
              ...(history.open > 0 ? [{ label: h.onLoan, value: formatMoney(history.open_principal) }] : []),
            ]
          : []
      }
      since={history?.first_date ? h.since.replace('{date}', shortDate(history.first_date)) : null}
      rows={(history?.recent ?? []).map((r) => ({
        id: r.loan_id,
        href: `/pawn/${r.loan_id}`,
        number: r.ticket_number,
        date: shortDate(r.issue_date),
        // Still the customer's to pick up, but past its due date.
        badge:
          r.days_overdue > 0
            ? {
                text:
                  r.days_overdue === 1
                    ? h.overdueOneDay
                    : h.overdueDays.replace('{n}', String(r.days_overdue)),
                className: OVERDUE_TONE,
              }
            : { text: h.outcome[r.outcome], className: OUTCOME_TONE[r.outcome] },
        amount: formatMoney(r.principal),
        detail: r.items.join(' · '),
      }))}
      allHref={`/pawn?customer=${customerId}&status=all`}
      allLabel={history ? h.all.replace('{n}', String(history.total + history.voided)) : undefined}
    />
  )
}
