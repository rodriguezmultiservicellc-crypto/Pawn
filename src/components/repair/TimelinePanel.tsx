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
  intake: 'border-hairline bg-cloud text-ink',
  quote_set: 'border-hairline bg-cloud text-ink',
  approved: 'border-success/30 bg-success/5 text-success',
  started: 'border-rausch/30 bg-rausch/5 text-rausch',
  paused: 'border-hairline bg-cloud text-ash',
  resumed: 'border-rausch/30 bg-rausch/5 text-rausch',
  parts_needed: 'border-warning/30 bg-warning/5 text-warning',
  parts_received: 'border-success/30 bg-success/5 text-success',
  completed: 'border-success/30 bg-success/5 text-success',
  pickup: 'border-success/30 bg-success/5 text-success',
  abandoned_conversion: 'border-error/30 bg-error/5 text-error',
  void: 'border-error/30 bg-error/5 text-error',
  note: 'border-hairline bg-cloud text-ink',
  photo_added: 'border-hairline bg-cloud text-ink',
  // Tech workflow events (0023).
  assigned_to_tech: 'border-rausch/30 bg-rausch/5 text-rausch-deep',
  claimed_by_tech: 'border-rausch/30 bg-rausch/5 text-rausch',
  qa_started: 'border-success/30 bg-success/5 text-success',
  qa_completed: 'border-success/30 bg-success/5 text-success',
  qa_returned: 'border-warning/30 bg-warning/5 text-warning',
}

export function TimelinePanel({ events }: { events: RepairEventItem[] }) {
  const { t } = useI18n()
  if (events.length === 0) {
    return (
      <section className="rounded-lg border border-hairline bg-canvas">
        <header className="flex items-center justify-between border-b border-hairline px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <ClockCounterClockwise size={14} weight="regular" />
            {t.repair.detail.sectionEvents}
          </h2>
        </header>
        <div className="px-4 py-6 text-center text-sm text-ash">
          {t.repair.detail.noEvents}
        </div>
      </section>
    )
  }
  return (
    <section className="rounded-lg border border-hairline bg-canvas">
      <header className="flex items-center justify-between border-b border-hairline px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <ClockCounterClockwise size={14} weight="regular" />
          {t.repair.detail.sectionEvents}
        </h2>
      </header>
      <ul className="divide-y divide-hairline">
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
                  <span className="font-mono text-xs text-ink">
                    {fmtMoney(e.amount)}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2 text-xs text-ash">
                <span>{relative(e.occurred_at, t)}</span>
                <span className="font-mono">
                  {new Date(e.occurred_at).toLocaleString()}
                </span>
              </div>
            </div>
            {e.notes ? (
              <div className="mt-1 text-xs text-ink">{e.notes}</div>
            ) : null}
            <div className="mt-1 text-[11px] text-ash">
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
