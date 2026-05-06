'use client'

import { useEffect, useState, useTransition } from 'react'
import { Clock, Play, Stop } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'

export type RepairTimeLogItem = {
  id: string
  technician_id: string
  technician_name: string | null
  started_at: string
  stopped_at: string | null
  notes: string | null
}

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
    <section className="rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Clock size={14} weight="regular" />
          {t.repair.detail.sectionTimer}
        </h2>
      </header>
      <div className="space-y-3 p-4">
        {error ? (
          <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
            {error}
          </div>
        ) : null}
        <div className="flex items-center justify-between rounded-md border border-border bg-background/40 px-3 py-2">
          <div>
            {myRunning ? (
              <div className="font-mono text-2xl text-foreground">{elapsed}</div>
            ) : (
              <div className="text-sm text-muted">
                {fmtTotal(totalMs)} {t.repair.detail.sectionTimer.toLowerCase()}
              </div>
            )}
            {myRunning ? (
              <div className="text-[11px] text-muted">
                started {new Date(myRunning.started_at).toLocaleTimeString()}
              </div>
            ) : null}
          </div>
          {myRunning ? (
            <button
              type="button"
              onClick={stop}
              disabled={pending}
              className="inline-flex items-center gap-1 rounded-md bg-danger px-3 py-2 text-sm text-white font-medium hover:bg-danger/90 disabled:opacity-50"
            >
              <Stop size={14} weight="bold" />
              {t.repair.actions.stopTimer}
            </button>
          ) : (
            <button
              type="button"
              onClick={start}
              disabled={pending}
              className="inline-flex items-center gap-1 rounded-md bg-gold px-3 py-2 text-sm text-navy font-medium hover:bg-gold-2 disabled:opacity-50"
            >
              <Play size={14} weight="bold" />
              {t.repair.actions.startTimer}
            </button>
          )}
        </div>
        {logs.length > 0 ? (
          <ul className="divide-y divide-border rounded-md border border-border">
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
                    <div className="font-medium text-foreground">
                      {l.technician_name ?? l.technician_id.slice(0, 8)}
                    </div>
                    <div className="font-mono text-muted">
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
    </section>
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

function fmtTotal(ms: number): string {
  if (ms === 0) return '00:00:00'
  return formatElapsed(ms)
}
