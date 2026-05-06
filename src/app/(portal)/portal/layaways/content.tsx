'use client'

import Link from 'next/link'
import { Tag, CaretRight } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { formatMoney, formatDateUtc } from '@/lib/portal/format'
import type { LayawayStatus } from '@/types/database-aliases'

export type PortalLayawayView = {
  id: string
  layawayNumber: string
  status: LayawayStatus
  totalDue: number
  paidTotal: number
  balanceRemaining: number
  scheduleKind: 'weekly' | 'biweekly' | 'monthly' | 'custom'
  firstPaymentDue: string | null
  finalDueDate: string | null
  createdAt: string
}

export default function PortalLayawaysList({
  layaways,
}: {
  layaways: PortalLayawayView[]
}) {
  const { t } = useI18n()

  if (layaways.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-2xl font-bold text-foreground">
          {t.portal.layaways.title}
        </h1>
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <Tag
            size={32}
            weight="regular"
            className="mx-auto mb-3 text-muted"
          />
          <p className="text-sm text-muted">{t.portal.layaways.empty}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-foreground">
        {t.portal.layaways.title}
      </h1>
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {layaways.map((l) => (
          <li key={l.id}>
            <Link
              href={`/portal/layaways/${l.id}`}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-background"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-foreground">
                    {l.layawayNumber}
                  </span>
                  <StatusPill status={l.status} />
                </div>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs text-muted">
                  <span>
                    {t.portal.layaways.balance}:{' '}
                    <span className="font-mono text-sm font-medium text-foreground">
                      {formatMoney(l.balanceRemaining)}
                    </span>
                  </span>
                  {l.firstPaymentDue ? (
                    <span>
                      {t.portal.layaways.nextDue}:{' '}
                      {formatDateUtc(l.firstPaymentDue)}
                    </span>
                  ) : null}
                </div>
              </div>
              <CaretRight size={16} weight="regular" className="text-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

function StatusPill({ status }: { status: LayawayStatus }) {
  const { t } = useI18n()
  const label = t.portal.layaways.statusBadges[status] ?? status
  const cls =
    status === 'active'
      ? 'bg-success/10 text-success'
      : status === 'completed'
      ? 'bg-background text-muted'
      : status === 'defaulted'
      ? 'bg-danger/10 text-danger'
      : 'bg-background text-muted'
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {label}
    </span>
  )
}
