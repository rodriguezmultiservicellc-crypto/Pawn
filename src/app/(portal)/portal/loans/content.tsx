'use client'

import Link from 'next/link'
import { Coins, CaretRight } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import type { LoanStatus } from '@/types/database-aliases'
import { formatMoney } from '@/lib/portal/format'

export type LoanStatusPill =
  | 'active'
  | 'due_soon'
  | 'past_due'
  | 'redeemed'
  | 'forfeited'
  | 'voided'
  | 'extended'
  | 'partial_paid'

export type PortalLoanView = {
  id: string
  ticketNumber: string
  principal: number
  payoff: number
  interestAccrued: number
  issueDate: string
  dueDate: string
  daysToDue: number
  collateralLine: string
  status: LoanStatus
  statusPill: LoanStatusPill
}

export default function PortalLoansList({
  loans,
}: {
  loans: PortalLoanView[]
}) {
  const { t } = useI18n()

  if (loans.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight text-ink">
          {t.portal.loans.title}
        </h1>
        <div className="rounded-xl border border-hairline bg-canvas p-8 text-center">
          <Coins
            size={32}
            weight="regular"
            className="mx-auto mb-3 text-ash"
          />
          <p className="text-sm text-ash">{t.portal.loans.empty}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight text-ink">
        {t.portal.loans.title}
      </h1>
      <ul className="divide-y divide-hairline overflow-hidden rounded-xl border border-hairline bg-canvas">
        {loans.map((l) => (
          <li key={l.id}>
            <Link
              href={`/portal/loans/${l.id}`}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-cloud"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-ink">
                    {l.ticketNumber}
                  </span>
                  <PillBadge pill={l.statusPill} />
                </div>
                <div className="truncate text-sm text-ash">
                  {l.collateralLine}
                </div>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs text-ash">
                  <span>
                    {t.portal.loans.payoff}:{' '}
                    <span className="font-mono text-sm font-medium text-ink">
                      {formatMoney(l.payoff)}
                    </span>
                  </span>
                  <span>
                    {t.portal.loans.dueDate}: {formatDate(l.dueDate)}
                  </span>
                </div>
              </div>
              <CaretRight size={16} weight="regular" className="text-ash" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

function PillBadge({ pill }: { pill: LoanStatusPill }) {
  const { t } = useI18n()
  const map: Record<LoanStatusPill, { label: string; className: string }> = {
    active: {
      label: t.portal.loans.statusActive,
      className: 'bg-success/10 text-success',
    },
    due_soon: {
      label: t.portal.loans.statusDueSoon,
      className: 'bg-warning/10 text-warning',
    },
    past_due: {
      label: t.portal.loans.statusPastDue,
      className: 'bg-error/10 text-error',
    },
    redeemed: {
      label: t.portal.loans.statusRedeemed,
      className: 'bg-cloud text-ash',
    },
    forfeited: {
      label: t.portal.loans.statusForfeited,
      className: 'bg-cloud text-ash',
    },
    voided: {
      label: t.portal.loans.statusVoided,
      className: 'bg-cloud text-ash',
    },
    extended: {
      label: t.portal.loans.statusExtended,
      className: 'bg-success/10 text-success',
    },
    partial_paid: {
      label: t.portal.loans.statusPartialPaid,
      className: 'bg-success/10 text-success',
    },
  }
  const { label, className } = map[pill]
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {label}
    </span>
  )
}

function formatDate(iso: string): string {
  // Treat YYYY-MM-DD as UTC midnight to avoid drift in local TZ display.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  const dt = new Date(
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])),
  )
  return dt.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}
