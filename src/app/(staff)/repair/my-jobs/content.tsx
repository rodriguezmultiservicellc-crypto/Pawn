'use client'

import { useEffect, useState, useTransition } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowSquareOut,
  CheckCircle,
  FlagCheckered,
  Image as ImageIcon,
  Play,
  Scales,
  Stop,
  Warning,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { FOCUS, INPUT, OUTLINE_BTN, PRIMARY_BTN } from '@/lib/ui/ledger'
import { StatusBadge } from '@/components/repair/StatusBadge'
import { PartsPanel, type RepairPartItem } from '@/components/repair/PartsPanel'
import type { InventoryPartOption } from '@/components/repair/AddPartDialog'
import { Footer, Modal } from '@/components/pawn/RecordPaymentDialog'
import {
  addPartAction,
  claimTicketAction,
  removePartAction,
  startTimerAction,
  stopTimerAction,
} from '../[id]/actions'
import { confirmReceiptAction, finishJobAction } from './actions'
import {
  fmtGramsChange,
  gramsChange,
  parseGrams,
  sameKarat,
} from '@/lib/repair/item-weights'
import type { TechnicianOption } from '@/lib/repair/technicians'
import type { RepairStatus } from '@/types/database-aliases'

export type MyJobItem = {
  id: string
  title: string
  work_needed: string | null
  /** What the clerk wrote at intake. */
  karat: string | null
  weight_grams: number | null
  /** What the tech weighed and read at the bench (patches/0132). */
  received_weight_grams: number | null
  received_karat: string | null
  received_at: string | null
  /** Weight when the work was done. */
  final_weight_grams: number | null
}

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
  items: MyJobItem[]
  parts: RepairPartItem[]
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
  partOptions,
  serverNow,
}: {
  jobs: MyJobView[]
  /** The list is the signed-in technician's own: timers can run. */
  isMe: boolean
  techId: string
  /** Owner / manager only: whose list to look at. Empty for a technician. */
  technicians: TechnicianOption[]
  /** Inventory a part can be taken from (a free-text part needs none). */
  partOptions: InventoryPartOption[]
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
          {tm.viewingOther.replaceAll('{name}', viewing.label)}
        </p>
      ) : null}

      {jobs.length === 0 ? (
        <div className="rounded-xl border border-border bg-card px-5 py-10 text-center text-sm text-text-secondary">
          {isMe ? tm.empty : tm.emptyOther}
        </div>
      ) : (
        <ul className="space-y-3">
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} now={now} canRun={isMe} partOptions={partOptions} />
          ))}
        </ul>
      )}
    </div>
  )
}

function JobCard({
  job,
  now,
  canRun,
  partOptions,
}: {
  job: MyJobView
  now: number
  canRun: boolean
  partOptions: InventoryPartOption[]
}) {
  const { t, lang } = useI18n()
  const tm = t.repair.myJobs
  const td = t.repair.detail
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'receive' | 'finish' | null>(null)

  const runMs = job.running ? Math.max(0, now - new Date(job.running.started_at).getTime()) : 0
  const totalMs = job.done_ms + runMs
  // Every item weighed in by the tech before any time goes on it.
  const needsReceipt = job.items.some((i) => i.received_at == null)
  const canFinish = job.status === 'in_progress' && !needsReceipt

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
        // An assigned job is claimed (In progress + timer); otherwise the timer starts.
        const res =
          kind === 'stop'
            ? await stopTimerAction(fd)
            : job.status === 'assigned'
              ? await claimTicketAction(fd)
              : await startTimerAction(fd)
        if (res.error) setError(jobErrorText(res.error, t))
      } catch {
        setError(tm.failed)
      }
    })
  }

  return (
    <li className={`rounded-xl border bg-card ${job.running ? 'border-success/50' : 'border-border'}`}>
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

        <div className="min-w-0 flex-[1_1_300px]">
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
          <ul className="mt-2 space-y-2.5">
            {job.items.length > 0 ? (
              job.items.map((li) => <ItemRow key={li.id} item={li} />)
            ) : (
              <li className="text-sm font-semibold text-foreground">{job.title}</li>
            )}
          </ul>
        </div>

        <div className="flex w-full flex-col items-stretch gap-2 sm:w-56">
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
          {/* A running timer can always be stopped, even one started before
              the items were weighed in. */}
          {canRun && job.running ? (
            <button
              type="button"
              onClick={() => run('stop')}
              disabled={pending}
              className={`${OUTLINE_BTN} h-12 text-base text-danger`}
            >
              <Stop size={18} weight="fill" />
              {tm.stop}
            </button>
          ) : null}
          {canRun && !job.closed ? (
            needsReceipt ? (
              <>
                <button
                  type="button"
                  onClick={() => setDialog('receive')}
                  disabled={pending}
                  className={job.running ? `${OUTLINE_BTN} h-11` : `${PRIMARY_BTN} h-12 text-base`}
                >
                  <Scales size={18} weight="bold" />
                  {tm.confirmReceived}
                </button>
                <p className="text-center text-[12.5px] text-text-secondary">{tm.confirmFirst}</p>
              </>
            ) : job.running ? null : (
              <button
                type="button"
                onClick={() => run('start')}
                disabled={pending}
                className={`${PRIMARY_BTN} h-12 text-base`}
              >
                <Play size={18} weight="fill" />
                {tm.start}
              </button>
            )
          ) : null}
          {canRun && canFinish ? (
            <button
              type="button"
              onClick={() => setDialog('finish')}
              disabled={pending}
              className={`${OUTLINE_BTN} h-11`}
            >
              <FlagCheckered size={16} weight="bold" />
              {tm.finish}
            </button>
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

      {/* Parts and materials: from stock or typed (solder, wire…). */}
      <div className="border-t border-border px-4 pb-4 pt-3">
        <PartsPanel
          ticketId={job.id}
          parts={job.parts}
          inventoryOptions={partOptions}
          quoteAmount={null}
          readOnly={!canRun || job.closed}
          onAdd={(fd) => addPartAction(fd)}
          onRemove={(partId, reason) => removePartAction(partId, reason)}
        />
      </div>

      {dialog === 'receive' ? (
        <WeighDialog mode="receive" job={job} onClose={() => setDialog(null)} />
      ) : dialog === 'finish' ? (
        <WeighDialog mode="finish" job={job} onClose={() => setDialog(null)} />
      ) : null}
    </li>
  )
}

/** One item: its work, then intake → received → finished weights. */
function ItemRow({ item }: { item: MyJobItem }) {
  const { t } = useI18n()
  const tm = t.repair.myJobs
  const recvDiff = gramsChange(item.weight_grams, item.received_weight_grams)
  const karatDiff = item.received_at != null && !sameKarat(item.karat, item.received_karat)
  const finalDiff = gramsChange(item.received_weight_grams, item.final_weight_grams)
  return (
    <li className="text-sm">
      <span className="font-semibold text-foreground">{item.title}</span>
      {item.work_needed ? <span className="block text-foreground">{item.work_needed}</span> : null}
      <span className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[13px] text-text-secondary">
        <span>
          {tm.intake}: {fmtWeightKarat(item.weight_grams, item.karat)}
        </span>
        {item.received_at ? (
          <span className={recvDiff != null || karatDiff ? 'font-semibold text-warning' : ''}>
            {recvDiff != null || karatDiff ? (
              <Warning size={13} weight="bold" className="mr-0.5 inline" />
            ) : (
              <CheckCircle size={13} weight="bold" className="mr-0.5 inline text-success" />
            )}
            {tm.received}: {fmtWeightKarat(item.received_weight_grams, item.received_karat)}
            {recvDiff != null ? ` (${fmtGramsChange(recvDiff)})` : ''}
          </span>
        ) : (
          <span className="font-semibold text-warning">{tm.notReceived}</span>
        )}
        {item.final_weight_grams != null ? (
          <span>
            {tm.finished}: {item.final_weight_grams} g{finalDiff != null ? ` (${fmtGramsChange(finalDiff)})` : ''}
          </span>
        ) : null}
      </span>
    </li>
  )
}

/**
 * The tech's scale readings for every item of the job: weight + karat when
 * receiving it, the ending weight when finishing (which sends it to QA).
 */
function WeighDialog({
  mode,
  job,
  onClose,
}: {
  mode: 'receive' | 'finish'
  job: MyJobView
  onClose: () => void
}) {
  const { t } = useI18n()
  const tm = t.repair.myJobs
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [weights, setWeights] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      job.items.map((i) => [
        i.id,
        mode === 'receive'
          ? (i.received_weight_grams ?? i.weight_grams)?.toString() ?? ''
          : (i.final_weight_grams ?? i.received_weight_grams)?.toString() ?? '',
      ]),
    ),
  )
  const [karats, setKarats] = useState<Record<string, string>>(() =>
    Object.fromEntries(job.items.map((i) => [i.id, i.received_karat ?? i.karat ?? ''])),
  )
  const allValid = job.items.every((i) => parseGrams(weights[i.id]) != null)

  function submit() {
    if (!allValid) {
      setError(tm.weightRequired)
      return
    }
    setError(null)
    const fd = new FormData()
    fd.set('ticket_id', job.id)
    fd.set('item_count', String(job.items.length))
    job.items.forEach((i, n) => {
      fd.set(`item_${n}_id`, i.id)
      if (mode === 'receive') {
        fd.set(`item_${n}_weight`, weights[i.id] ?? '')
        fd.set(`item_${n}_karat`, karats[i.id] ?? '')
      } else {
        fd.set(`item_${n}_final_weight`, weights[i.id] ?? '')
      }
    })
    startTransition(async () => {
      try {
        const res = await (mode === 'receive' ? confirmReceiptAction(fd) : finishJobAction(fd))
        if (res.error) setError(jobErrorText(res.error, t))
        else onClose()
      } catch {
        setError(tm.failed)
      }
    })
  }

  return (
    <Modal title={mode === 'receive' ? tm.receiveTitle : tm.finishTitle} onClose={onClose}>
      <p className="mb-3 text-sm text-text-secondary">
        {mode === 'receive' ? tm.receiveBody : tm.finishBody}
      </p>
      <div className="space-y-4">
        {job.items.map((i) => {
          const typed = parseGrams(weights[i.id])
          const before = mode === 'receive' ? i.weight_grams : i.received_weight_grams
          const d = gramsChange(before, typed)
          const karatOff = mode === 'receive' && !sameKarat(i.karat, karats[i.id])
          return (
            <fieldset key={i.id} className="rounded-lg border border-border p-3">
              <legend className="px-1 text-sm font-bold text-foreground">{i.title}</legend>
              <div className="text-[13px] text-text-secondary">
                {mode === 'receive'
                  ? `${tm.intake}: ${fmtWeightKarat(i.weight_grams, i.karat)}`
                  : `${tm.received}: ${fmtWeightKarat(i.received_weight_grams, i.received_karat)}`}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-sm font-semibold text-foreground">
                    {mode === 'receive' ? tm.weightNow : tm.endingWeight} *
                  </span>
                  <div className="relative">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={weights[i.id] ?? ''}
                      onChange={(e) => setWeights((w) => ({ ...w, [i.id]: e.target.value }))}
                      aria-invalid={typed == null}
                      className={`${INPUT} pr-8 font-mono`}
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-text-secondary">
                      g
                    </span>
                  </div>
                </label>
                {mode === 'receive' ? (
                  <label className="block space-y-1">
                    <span className="text-sm font-semibold text-foreground">{tm.karat}</span>
                    <input
                      type="text"
                      value={karats[i.id] ?? ''}
                      onChange={(e) => setKarats((k) => ({ ...k, [i.id]: e.target.value }))}
                      maxLength={12}
                      className={`${INPUT} font-mono`}
                    />
                  </label>
                ) : null}
              </div>
              {d != null || karatOff ? (
                <p className="mt-1.5 text-[13px] font-semibold text-warning">
                  {d != null ? `${mode === 'receive' ? tm.differsFromIntake : tm.changed} ${fmtGramsChange(d)}` : ''}
                  {d != null && karatOff ? ' · ' : ''}
                  {karatOff ? tm.karatDiffers : ''}
                </p>
              ) : null}
            </fieldset>
          )
        })}
      </div>
      {error ? (
        <div role="alert" className="mt-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}
      <Footer>
        <button type="button" onClick={onClose} className={OUTLINE_BTN}>
          {t.common.cancel}
        </button>
        <button type="button" onClick={submit} disabled={pending} className={`${PRIMARY_BTN} h-11`}>
          {mode === 'receive' ? <Scales size={16} weight="bold" /> : <FlagCheckered size={16} weight="bold" />}
          {pending ? t.common.saving : mode === 'receive' ? tm.confirmReceived : tm.finishSend}
        </button>
      </Footer>
    </Modal>
  )
}

function jobErrorText(code: string, t: ReturnType<typeof useI18n>['t']): string {
  const tm = t.repair.myJobs
  switch (code) {
    case 'ticket_closed':
      return tm.ticketClosed
    case 'receipt_required':
      return tm.confirmFirst
    case 'weight_required':
      return tm.weightRequired
    case 'timerAlreadyRunning':
      return t.repair.errors.timerAlreadyRunning
    case 'timerNotFound':
      return t.repair.errors.timerNotFound
    case 'notAuthorized':
      return t.repair.errors.notAuthorized
    case 'illegalTransition':
      return t.repair.errors.illegalTransition
    default:
      return tm.failed
  }
}

function fmtWeightKarat(grams: number | null, karat: string | null): string {
  return [grams != null ? `${grams} g` : null, karat].filter(Boolean).join(' · ') || '—'
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
