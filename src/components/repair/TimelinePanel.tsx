'use client'

import { ClockCounterClockwise } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import type {
  RepairEventType,
  RepairStatus,
} from '@/types/database-aliases'

export type RepairEventItem = {
  id: string
  event_type: RepairEventType
  notes: string | null
  amount: number | null
  new_status: RepairStatus | null
  performed_by_name: string | null
  occurred_at: string
}

const TONE: Record<RepairEventType, string> = {
  intake: 'border-border bg-background text-foreground',
  quote_set: 'border-border bg-background text-foreground',
  approved: 'border-success/30 bg-success/5 text-success',
  started: 'border-gold/30 bg-gold/5 text-gold',
  paused: 'border-border bg-background text-muted',
  resumed: 'border-gold/30 bg-gold/5 text-gold',
  parts_needed: 'border-warning/30 bg-warning/5 text-warning',
  parts_received: 'border-success/30 bg-success/5 text-success',
  completed: 'border-success/30 bg-success/5 text-success',
  pickup: 'border-success/30 bg-success/5 text-success',
  abandoned_conversion: 'border-danger/30 bg-danger/5 text-danger',
  void: 'border-danger/30 bg-danger/5 text-danger',
  note: 'border-border bg-background text-foreground',
  photo_added: 'border-border bg-background text-foreground',
  // Tech workflow events (0023).
  assigned_to_tech: 'border-gold/30 bg-gold/5 text-gold-2',
  claimed_by_tech: 'border-gold/30 bg-gold/5 text-gold',
  qa_started: 'border-success/30 bg-success/5 text-success',
  qa_completed: 'border-success/30 bg-success/5 text-success',
  qa_returned: 'border-warning/30 bg-warning/5 text-warning',
}

export function TimelinePanel({ events }: { events: RepairEventItem[] }) {
  const { t } = useI18n()
  if (events.length === 0) {
    return (
      <section className="rounded-lg border border-border bg-card">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ClockCounterClockwise size={14} weight="regular" />
            {t.repair.detail.sectionEvents}
          </h2>
        </header>
        <div className="px-4 py-6 text-center text-sm text-muted">
          {t.repair.detail.noEvents}
        </div>
      </section>
    )
  }
  return (
    <section className="rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ClockCounterClockwise size={14} weight="regular" />
          {t.repair.detail.sectionEvents}
        </h2>
      </header>
      <ul className="divide-y divide-border">
        {events.map((e) => (
          <li key={e.id} className="px-4 py-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${TONE[e.event_type]}`}
                >
                  {labelForEvent(e.event_type, t)}
                </span>
                {e.amount != null ? (
                  <span className="font-mono text-xs text-foreground">
                    {fmtMoney(e.amount)}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted">
                <span>{relative(e.occurred_at, t)}</span>
                <span className="font-mono">
                  {new Date(e.occurred_at).toLocaleString()}
                </span>
              </div>
            </div>
            {e.notes ? (
              <div className="mt-1 text-xs text-foreground">{e.notes}</div>
            ) : null}
            <div className="mt-1 text-[11px] text-muted">
              {e.performed_by_name ?? t.repair.timeline.noActor}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function labelForEvent(
  type: RepairEventType,
  t: ReturnType<typeof useI18n>['t'],
): string {
  return t.repair.events[type]
}

function fmtMoney(v: number): string {
  if (!isFinite(v)) return '—'
  return v.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  })
}

function relative(iso: string, t: ReturnType<typeof useI18n>['t']): string {
  const ts = new Date(iso).getTime()
  if (!isFinite(ts)) return ''
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (seconds < 30) return t.repair.timeline.relativeJustNow
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  return `${d}d`
}
