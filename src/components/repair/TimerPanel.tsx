'use client'

import { useEffect, useState, useTransition } from 'react'
import { Clock, Play, Stop } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { OUTLINE_BTN } from '@/lib/ui/ledger'

export type RepairTimeLogItem = {
  id: string
  technician_id: string
  technician_name: string | null
  started_at: string
  stopped_at: string | null
  notes: string | null
}

/**
 * Time on the job: the total (or my running timer), Start / Stop, and the
 * logs behind "Show time logs". No card of its own — it sits in the
 * Technician card on the ticket page.
 */
export function TimerPanel({
  ticketId,
  logs,
  myUserId,
  onStart,
  onStop,
}: {
  ticketId: string
  logs: RepairTimeLogItem[]
  /** Current user — used to identify the running timer (if any) belonging to them. */
  myUserId: string | null
  onStart: (
    formData: FormData,
  ) => Promise<{ error?: string; ok?: boolean }>
  onStop: (
    formData: FormData,
  ) => Promise<{ error?: string; ok?: boolean }>
}) {
  const { t } = useI18n()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState<number>(() => Date.now())
  const [showLogs, setShowLogs] = useState(false)

  // Active timer = any log with stopped_at IS NULL belonging to me.
  const myRunning = logs.find(
    (l) => l.stopped_at == null && l.technician_id === myUserId,
  )

  useEffect(() => {
    if (!myRunning) return
    const id = setInterval(() => setTick(Date.now()), 1000)
    return () => clearInterval(id)
  }, [myRunning])

  function start() {
    setError(null)
    const fd = new FormData()
    fd.set('ticket_id', ticketId)
    startTransition(async () => {
      const res = await onStart(fd)
      if (res.error) setError(res.error)
    })
  }

  function stop() {
    if (!myRunning) return
    setError(null)
    const fd = new FormData()
    fd.set('time_log_id', myRunning.id)
    startTransition(async () => {
      const res = await onStop(fd)
      if (res.error) setError(res.error)
    })
  }

  const elapsed = myRunning
    ? formatElapsed(tick - new Date(myRunning.started_at).getTime())
    : null

  const totalMs = logs.reduce((sum, l) => {
    const start = new Date(l.started_at).getTime()
    const stop = l.stopped_at
      ? new Date(l.stopped_at).getTime()
      : myRunning?.id === l.id
      ? tick
      : null
    if (stop == null || !isFinite(start) || !isFinite(stop)) return sum
    return sum + Math.max(0, stop - start)
  }, 0)

  return (
    <div className="space-y-3">
      {error ? (
        <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
          {error}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[12px] font-bold uppercase tracking-wide text-text-secondary">
            {t.repair.detail.timeOnJob}
          </div>
          <div className="font-mono text-xl font-bold tabular-nums text-foreground">
            {myRunning ? elapsed : formatElapsed(totalMs)}
          </div>
          {myRunning ? (
            <div className="text-xs text-text-secondary">
              {t.repair.detail.timerStarted.replace(
                '{time}',
                new Date(myRunning.started_at).toLocaleTimeString(),
              )}
            </div>
          ) : null}
        </div>
        {myRunning ? (
          <button
            type="button"
            onClick={stop}
            disabled={pending}
            className={`${OUTLINE_BTN} text-danger`}
          >
            <Stop size={16} weight="bold" />
            {t.repair.actions.stopTimer}
          </button>
        ) : (
          <button type="button" onClick={start} disabled={pending} className={OUTLINE_BTN}>
            <Play size={16} weight="bold" />
            {t.repair.actions.startTimer}
          </button>
        )}
      </div>
      {logs.length > 0 ? (
        <div>
          <button
            type="button"
            aria-expanded={showLogs}
            onClick={() => setShowLogs((v) => !v)}
            className="inline-flex min-h-9 items-center gap-1 rounded-md text-sm font-bold text-blue hover:underline"
          >
            <Clock size={14} weight="bold" />
            {showLogs ? t.repair.detail.hideTimeLogs : t.repair.detail.showTimeLogs}
            <span className="font-mono text-xs text-text-secondary">({logs.length})</span>
          </button>
          {showLogs ? (
            <ul className="mt-2 divide-y divide-border rounded-md border border-border">
              {logs.slice(0, 10).map((l) => {
                const start = new Date(l.started_at).getTime()
                const stop = l.stopped_at
                  ? new Date(l.stopped_at).getTime()
                  : myRunning?.id === l.id
                  ? tick
                  : null
                const duration =
                  stop != null && isFinite(start) && isFinite(stop)
                    ? stop - start
                    : null
                return (
                  <li
                    key={l.id}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-foreground">
                        {l.technician_name ?? l.technician_id.slice(0, 8)}
                      </div>
                      <div className="font-mono text-text-secondary">
                        {new Date(l.started_at).toLocaleString()}
                        {l.stopped_at
                          ? ` → ${new Date(l.stopped_at).toLocaleTimeString()}`
                          : ' → …'}
                      </div>
                    </div>
                    <div className="font-mono text-foreground">
                      {duration != null ? formatElapsed(duration) : '—'}
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function formatElapsed(ms: number): string {
  if (!isFinite(ms) || ms < 0) ms = 0
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
