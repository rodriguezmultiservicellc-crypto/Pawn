'use client'

import { useEffect, useState, useTransition } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowSquareOut, Image as ImageIcon, Play, Stop } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { FOCUS, OUTLINE_BTN, PRIMARY_BTN } from '@/lib/ui/ledger'
import { StatusBadge } from '@/components/repair/StatusBadge'
import { startTimerAction, stopTimerAction } from '../[id]/actions'
import type { TechnicianOption } from '@/lib/repair/technicians'
import type { RepairStatus } from '@/types/database-aliases'

export type MyJobView = {
  id: string
  ticket_number: string
  title: string
  status: RepairStatus
  /** First name only: enough to call out a job at the bench. */
  customer_first_name: string | null
  promised_date: string | null
  /** Days past the promised date by the shop's calendar (0 = due today). */
  late_by: number | null
  items: Array<{ id: string; title: string; work_needed: string | null }>
  photo_url: string | null
  /** This technician's finished sessions on the job. */
  done_ms: number
  /** This technician's running timer on the job, if any. */
  running: { id: string; started_at: string } | null
  /** Picked up / abandoned / voided: no timer can start. */
  closed: boolean
}

export default function MyJobsContent({
  jobs,
  isMe,
  techId,
  technicians,
  serverNow,
}: {
  jobs: MyJobView[]
  /** The list is the signed-in technician's own: timers can run. */
  isMe: boolean
  techId: string
  /** Owner / manager only: whose list to look at. Empty for a technician. */
  technicians: TechnicianOption[]
  /** The time the server rendered at, so the first paint matches. */
  serverNow: number
}) {
  const { t } = useI18n()
  const tm = t.repair.myJobs
  const router = useRouter()

  // One clock for every running timer; it starts at the server's time so the
  // browser's first render matches the server's.
  const [now, setNow] = useState(serverNow)
  const anyRunning = jobs.some((j) => j.running)
  useEffect(() => {
    if (!anyRunning) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [anyRunning])

  const viewing = technicians.find((x) => x.id === techId)

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">{tm.title}</h1>
          <p className="mt-1 text-sm text-text-secondary">{isMe ? tm.subtitle : tm.subtitleOther}</p>
        </div>
        {technicians.length > 0 ? (
          <label className="flex items-center gap-2 text-sm text-foreground">
            <span className="font-semibold">{tm.technician}</span>
            <select
              value={techId}
              onChange={(e) => router.push(`/repair/my-jobs?tech=${encodeURIComponent(e.target.value)}`)}
              className={`h-11 rounded-md border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-blue ${FOCUS}`}
            >
              {technicians.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </header>

      {!isMe && viewing ? (
        <p className="rounded-md border border-info/30 bg-info/5 px-3 py-2 text-sm text-foreground">
          {tm.viewingOther.replace('{name}', viewing.label)}
        </p>
      ) : null}

      {jobs.length === 0 ? (
        <div className="rounded-xl border border-border bg-card px-5 py-10 text-center text-sm text-text-secondary">
          {isMe ? tm.empty : tm.emptyOther}
        </div>
      ) : (
        <ul className="space-y-3">
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} now={now} canRun={isMe} />
          ))}
        </ul>
      )}
    </div>
  )
}

function JobCard({ job, now, canRun }: { job: MyJobView; now: number; canRun: boolean }) {
  const { t, lang } = useI18n()
  const tm = t.repair.myJobs
  const td = t.repair.detail
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const runMs = job.running ? Math.max(0, now - new Date(job.running.started_at).getTime()) : 0
  const totalMs = job.done_ms + runMs

  const due =
    job.late_by == null || job.closed
      ? null
      : job.late_by === 0
      ? { text: td.dueToday, tone: 'text-warning' }
      : job.late_by > 0
      ? {
          text: job.late_by === 1 ? td.overdueOne : td.overdueDays.replace('{n}', String(job.late_by)),
          tone: 'text-danger',
        }
      : null

  function run(kind: 'start' | 'stop') {
    setError(null)
    const fd = new FormData()
    if (kind === 'start') fd.set('ticket_id', job.id)
    else if (job.running) fd.set('time_log_id', job.running.id)
    startTransition(async () => {
      try {
        const res = await (kind === 'start' ? startTimerAction(fd) : stopTimerAction(fd))
        if (res.error) setError(errorText(res.error))
      } catch {
        setError(tm.failed)
      }
    })
  }

  function errorText(code: string): string {
    if (code === 'ticket_closed') return tm.ticketClosed
    if (code === 'timerAlreadyRunning') return t.repair.errors.timerAlreadyRunning
    if (code === 'timerNotFound') return t.repair.errors.timerNotFound
    if (code === 'notAuthorized') return t.repair.errors.notAuthorized
    return tm.failed
  }

  return (
    <li
      className={`rounded-xl border bg-card ${job.running ? 'border-success/50' : 'border-border'}`}
    >
      <div className="flex flex-wrap items-start gap-4 p-4">
        <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg border border-border bg-background">
          {job.photo_url ? (
            <Image src={job.photo_url} alt="" fill sizes="96px" unoptimized className="object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-text-secondary">
              <ImageIcon size={22} weight="regular" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-[1_1_260px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-lg font-bold text-foreground">{job.ticket_number}</span>
            <StatusBadge status={job.status} />
            {due ? <span className={`text-sm font-bold ${due.tone}`}>{due.text}</span> : null}
          </div>
          <div className="mt-0.5 text-sm text-text-secondary">
            {[job.customer_first_name, job.promised_date ? `${td.promisedLabel} ${fmtDay(job.promised_date, lang)}` : null]
              .filter(Boolean)
              .join(' · ')}
          </div>
          <ul className="mt-2 space-y-1.5">
            {(job.items.length > 0 ? job.items : [{ id: 'title', title: job.title, work_needed: null }]).map((li) => (
              <li key={li.id} className="text-sm">
                <span className="font-semibold text-foreground">{li.title}</span>
                {li.work_needed ? (
                  <span className="block text-foreground">{li.work_needed}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex w-full flex-col items-stretch gap-2 sm:w-52">
          <div className="text-right">
            <div className="text-[12px] font-bold uppercase tracking-wide text-text-secondary">
              {job.running ? tm.running : tm.myTime}
            </div>
            <div
              className={`font-mono text-[28px] font-bold leading-tight tabular-nums ${job.running ? 'text-success' : 'text-foreground'}`}
            >
              {fmtClock(totalMs)}
            </div>
          </div>
          {canRun ? (
            job.running ? (
              <button type="button" onClick={() => run('stop')} disabled={pending} className={`${OUTLINE_BTN} h-12 text-base text-danger`}>
                <Stop size={18} weight="fill" />
                {tm.stop}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => run('start')}
                disabled={pending || job.closed}
                className={`${PRIMARY_BTN} h-12 text-base`}
              >
                <Play size={18} weight="fill" />
                {tm.start}
              </button>
            )
          ) : null}
          <Link href={`/repair/${job.id}`} className={`${OUTLINE_BTN} h-10`}>
            <ArrowSquareOut size={16} weight="bold" />
            {tm.openTicket}
          </Link>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </li>
  )
}

/** 1:05:09 / 0:04:12. */
function fmtClock(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

function fmtDay(ymd: string, lang: string): string {
  const d = new Date(`${ymd}T12:00:00Z`)
  if (isNaN(d.getTime())) return ymd
  return d.toLocaleDateString(lang === 'es' ? 'es-US' : 'en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}
