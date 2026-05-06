'use client'

import { useI18n } from '@/lib/i18n/context'
import { type PayoffResult, daysBetween, todayDateString } from '@/lib/pawn/math'

/**
 * Pure render — no actions. Shows the current payoff balance breakdown plus
 * the days-to-due / days-overdue indicator. Caller computes the
 * PayoffResult via lib/pawn/math.payoffFromLoan() with the loan + events.
 */
export function PayoffCalculator({
  payoff,
  dueDate,
  today,
}: {
  payoff: PayoffResult
  dueDate: string
  today?: string
}) {
  const { t } = useI18n()
  const todayStr = today ?? todayDateString()
  const days = daysBetween(todayStr, dueDate)
  // days > 0 -> due in N days; days < 0 -> overdue by N
  const isOverdue = days < 0

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">
          {t.pawn.detail.payoffPanelTitle}
        </h2>
        <DueBadge days={days} isOverdue={isOverdue} />
      </header>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <Row label={t.pawn.detail.principal} value={fmt(payoff.principal)} />
        <Row
          label={t.pawn.detail.principalOutstanding}
          value={fmt(payoff.principalOutstanding)}
        />
        <Row
          label={t.pawn.detail.interestAccrued}
          value={fmt(payoff.interestAccrued)}
        />
        <Row
          label={t.pawn.detail.interestOutstanding}
          value={fmt(payoff.interestOutstanding)}
        />
      </dl>

      <div className="mt-4 flex items-center justify-between rounded-lg border border-navy/20 bg-navy/5 px-3 py-2">
        <span className="text-sm font-semibold text-foreground">
          {t.pawn.detail.totalDue}
        </span>
        <span className="font-mono text-xl font-bold text-navy">
          {fmt(payoff.payoff)}
        </span>
      </div>
    </section>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-mono text-foreground">{value}</dd>
    </>
  )
}

function DueBadge({ days, isOverdue }: { days: number; isOverdue: boolean }) {
  const { t } = useI18n()
  if (isOverdue) {
    return (
      <span className="inline-flex items-center rounded-full border border-danger/30 bg-danger/5 px-2 py-0.5 text-xs font-medium text-danger">
        {t.pawn.detail.daysOverdue}: {Math.abs(days)}
      </span>
    )
  }
  const tone =
    days <= 7 ? 'border-warning/30 bg-warning/5 text-warning' : 'border-border bg-background text-muted'
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tone}`}>
      {t.pawn.detail.daysToDue}: {days}
    </span>
  )
}

function fmt(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  })
}
