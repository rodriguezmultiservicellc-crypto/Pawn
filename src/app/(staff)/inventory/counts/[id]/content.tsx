'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowsClockwise, Barcode, CheckCircle, SpeakerHigh, SpeakerSlash, Warning, X } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import type { Dictionary } from '@/lib/i18n/en'
import { formatMoney } from '@/lib/format/money'
import { absoluteTimestamp } from '@/lib/format/datetime'
import type { CountSession, ExpectedRow, RecentRead, StoredException } from '@/lib/counts/server'
import {
  exceptionSeverity,
  RESOLUTIONS,
  type CountError,
  type CountProgress,
  type ExceptionKind,
  type Finding,
  type ReadOutcome,
  type ReadResult,
  type Resolution,
} from '@/lib/counts/types'
import { countScopeLabel, OUTCOME_TONE, reasonLabel, SEVERITY_TONE, STATUS_TONE } from '@/components/counts/labels'
import { cancelCountAction, closeCountAction, resolveExceptionAction } from '../actions'

const NOT_SEEN_LIMIT = 200
const FEED_LIMIT = 50
const SOUND_KEY = 'pawn-count-sound'

/** Sound on/off, remembered per browser. Server render assumes on. */
function subscribeSound(cb: () => void) {
  window.addEventListener('storage', cb)
  window.addEventListener(SOUND_KEY, cb)
  return () => {
    window.removeEventListener('storage', cb)
    window.removeEventListener(SOUND_KEY, cb)
  }
}
function readSound(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== '0'
  } catch {
    return true
  }
}
function writeSound(on: boolean) {
  try {
    localStorage.setItem(SOUND_KEY, on ? '1' : '0')
  } catch {}
  window.dispatchEvent(new Event(SOUND_KEY))
}

type FeedRow = { key: string; code: string; outcome: ReadOutcome; description: string | null }

export default function CountDetail(props: {
  session: CountSession
  progress: CountProgress
  notSeen: ExpectedRow[]
  recent: RecentRead[]
  findings: Finding[]
  exceptions: StoredException[]
  canResolve: boolean
}) {
  const { t } = useI18n()
  const s = props.session

  return (
    <div className="space-y-6">
      <div>
        <Link href="/inventory/counts" className="text-sm text-muted hover:text-foreground">
          ← {t.counts.summary.backToList}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-bold text-foreground">
            {t.counts.kinds[s.kind]} <span className="font-mono text-xl">{s.count_number}</span>
          </h1>
          <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_TONE[s.status]}`}>
            {t.counts.statuses[s.status]}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted">
          {countScopeLabel(s, t)} · {t.counts.summary.started} {absoluteTimestamp(s.started_at)}
          {s.closed_at ? ` · ${t.counts.summary.closed} ${absoluteTimestamp(s.closed_at)}` : ''}
        </p>
        {s.note ? <p className="mt-1 text-sm text-foreground">{s.note}</p> : null}
        {s.transfer_id ? (
          <Link href={`/inventory/transfers/${s.transfer_id}`} className="mt-1 inline-block text-sm text-blue hover:text-blue-2">
            {t.counts.summary.transferLink} →
          </Link>
        ) : null}
      </div>

      {s.status === 'open' ? (
        <OpenCount {...props} />
      ) : s.status === 'cancelled' ? (
        <div className="rounded-xl border border-border bg-card px-5 py-4 text-sm text-muted">{t.counts.summary.cancelled}</div>
      ) : (
        <ClosedCount session={s} exceptions={props.exceptions} canResolve={props.canResolve} />
      )}
    </div>
  )
}

// ── Open: scan + live review ─────────────────────────────────────────────

function OpenCount(props: {
  session: CountSession
  progress: CountProgress
  notSeen: ExpectedRow[]
  recent: RecentRead[]
  findings: Finding[]
}) {
  const { t } = useI18n()
  const router = useRouter()
  const sessionId = props.session.id

  // Live progress from the API, reset whenever the server sends fresh props.
  const [propsProgress, setPropsProgress] = useState(props.progress)
  const [progress, setProgress] = useState(props.progress)
  if (propsProgress !== props.progress) {
    setPropsProgress(props.progress)
    setProgress(props.progress)
  }

  const [feed, setFeed] = useState<FeedRow[]>(() =>
    props.recent.map((r, i) => ({ key: `init-${i}`, code: r.code, outcome: r.outcome, description: r.description })),
  )
  const [code, setCode] = useState('')
  const [saving, setSaving] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [closed, setClosed] = useState(false)
  const sound = useSyncExternalStore(subscribeSound, readSound, () => true)
  const inputRef = useRef<HTMLInputElement>(null)
  const queue = useRef<string[]>([])
  const sending = useRef(false)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seq = useRef(0)
  const audio = useRef<AudioContext | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const beep = useCallback(
    (outcome: ReadOutcome) => {
      if (!sound || outcome === 'repeat') return
      try {
        audio.current ??= new AudioContext()
        const ctx = audio.current
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        const good = outcome === 'expected'
        osc.frequency.value = good ? 880 : 220
        gain.gain.value = 0.08
        osc.connect(gain).connect(ctx.destination)
        osc.start()
        osc.stop(ctx.currentTime + (good ? 0.08 : 0.25))
      } catch {}
    },
    [sound],
  )

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => router.refresh(), 1500)
  }, [router])

  const flush = useCallback(async () => {
    if (sending.current) return
    sending.current = true
    setSaving(true)
    try {
      while (queue.current.length > 0) {
        const batch = queue.current.splice(0, 100)
        let res: Response
        try {
          res = await fetch(`/api/counts/${sessionId}/reads`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ codes: batch, source: 'scanner' }),
          })
        } catch {
          res = new Response(null, { status: 503 })
        }
        if (res.status === 409) {
          queue.current = []
          setClosed(true)
          break
        }
        if (!res.ok) {
          // Keep the codes and try again shortly; nothing scanned is dropped.
          queue.current.unshift(...batch)
          setRetrying(true)
          await new Promise((r) => setTimeout(r, 2500))
          continue
        }
        setRetrying(false)
        const json = (await res.json()) as { results: ReadResult[]; progress: CountProgress }
        setProgress(json.progress)
        const rows = json.results.map((r) => ({ key: `r-${seq.current++}`, ...r }))
        setFeed((prev) => [...rows.reverse(), ...prev].slice(0, FEED_LIMIT))
        const last = json.results[json.results.length - 1]
        if (last) beep(last.outcome)
      }
    } finally {
      sending.current = false
      setSaving(false)
      scheduleRefresh()
    }
  }, [sessionId, beep, scheduleRefresh])

  useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
    },
    [],
  )

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const v = code.trim()
    setCode('')
    if (!v || closed) return
    queue.current.push(v)
    void flush()
  }

  function toggleSound() {
    writeSound(!sound)
  }

  const pct = progress.expected > 0 ? Math.round((progress.seen / progress.expected) * 100) : 0
  const last = feed[0]

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
      <div className="space-y-6 lg:col-span-3">
        <section className="space-y-4 rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Barcode size={18} /> {t.counts.scan.title}
            </h2>
            <button
              type="button"
              onClick={toggleSound}
              className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground"
              aria-pressed={sound}
            >
              {sound ? <SpeakerHigh size={14} /> : <SpeakerSlash size={14} />} {t.counts.scan.sound}
            </button>
          </div>

          {closed ? (
            <p className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-muted">{t.counts.scan.notOpen}</p>
          ) : (
            <form onSubmit={onSubmit}>
              <input
                ref={inputRef}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder={t.counts.scan.placeholder}
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-xl border border-border bg-card px-4 py-3 font-mono text-lg text-foreground focus:border-blue focus:outline-none"
              />
              <p className="mt-1 text-xs text-muted">{t.counts.scan.help}</p>
            </form>
          )}

          <div>
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-foreground">
                {t.counts.scan.seen}{' '}
                <span className="font-mono font-semibold">{progress.seen}</span> {t.counts.scan.of}{' '}
                <span className="font-mono">{progress.expected}</span>
              </span>
              <span className={progress.extra > 0 ? 'text-warning' : 'text-muted'}>
                {t.counts.scan.extra}: <span className="font-mono">{progress.extra}</span>
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-background">
              <div className="h-full bg-success transition-[width] duration-150" style={{ width: `${pct}%` }} />
            </div>
            {saving || retrying ? (
              <p className={`mt-1 text-xs ${retrying ? 'text-warning' : 'text-muted'}`}>
                {retrying ? t.counts.scan.retrying : t.counts.scan.saving}
              </p>
            ) : null}
          </div>

          {last ? (
            <div className={`rounded-xl border px-4 py-3 ${OUTCOME_TONE[last.outcome]}`}>
              <p className="text-sm font-semibold">{t.counts.outcomes[last.outcome]}</p>
              <p className="font-mono text-sm">{last.code}</p>
              {last.description ? <p className="truncate text-xs">{last.description}</p> : null}
            </div>
          ) : null}
        </section>

        <ReviewPanel sessionId={sessionId} findings={props.findings} isVault={props.session.kind === 'vault'} />
      </div>

      <div className="space-y-6 lg:col-span-2">
        <section className="rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <h2 className="text-sm font-semibold text-foreground">
              {t.counts.scan.notSeen} <span className="font-normal text-muted">({props.notSeen.length})</span>
            </h2>
            <button
              type="button"
              onClick={() => router.refresh()}
              className="inline-flex items-center gap-1 text-xs text-blue hover:text-blue-2"
            >
              <ArrowsClockwise size={12} /> {t.counts.scan.refresh}
            </button>
          </div>
          {props.notSeen.length === 0 ? (
            <p className="flex items-center gap-2 px-5 py-4 text-sm text-success">
              <CheckCircle size={16} weight="fill" /> {t.counts.scan.allSeen}
            </p>
          ) : (
            <ul className="max-h-96 divide-y divide-border overflow-y-auto">
              {props.notSeen.slice(0, NOT_SEEN_LIMIT).map((e) => (
                <li key={e.id} className="px-5 py-2">
                  <RecordLink inventoryItemId={e.inventory_item_id} loanId={e.loan_id} code={e.code} />
                  {e.description ? <p className="truncate text-xs text-muted">{e.description}</p> : null}
                </li>
              ))}
            </ul>
          )}
          {props.notSeen.length > NOT_SEEN_LIMIT ? (
            <p className="border-t border-border px-5 py-2 text-xs text-muted">
              {t.counts.scan.showingFirst.replace('{n}', String(NOT_SEEN_LIMIT))}
            </p>
          ) : null}
        </section>

        <section className="rounded-xl border border-border bg-card">
          <h2 className="border-b border-border px-5 py-3 text-sm font-semibold text-foreground">{t.counts.scan.recent}</h2>
          {feed.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted">{t.counts.scan.noneYet}</p>
          ) : (
            <ul className="max-h-96 divide-y divide-border overflow-y-auto">
              {feed.map((r) => (
                <li key={r.key} className="flex items-center gap-3 px-5 py-2">
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${OUTCOME_TONE[r.outcome]}`}>
                    {t.counts.outcomes[r.outcome]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-sm text-foreground">{r.code}</span>
                    {r.description ? <span className="block truncate text-xs text-muted">{r.description}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

function ReviewPanel({ sessionId, findings, isVault }: { sessionId: string; findings: Finding[]; isVault: boolean }) {
  const { t } = useI18n()
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [error, setError] = useState<CountError | null>(null)
  const [pending, startTransition] = useTransition()
  const pledges = findings.filter((f) => f.kind === 'missing_pledge')

  function close() {
    if (!confirm(t.counts.review.confirmClose)) return
    setError(null)
    startTransition(async () => {
      const res = await closeCountAction(sessionId, notes)
      if (!res.ok) setError(res.error)
    })
  }

  function cancel() {
    if (!confirm(t.counts.review.confirmCancel)) return
    setError(null)
    startTransition(async () => {
      const res = await cancelCountAction(sessionId)
      if (!res.ok) setError(res.error)
    })
  }

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div>
        <h2 className="text-sm font-semibold text-foreground">{t.counts.review.title}</h2>
        <p className="mt-1 text-xs text-muted">{t.counts.review.help}</p>
      </div>

      {isVault && pledges.length > 0 ? (
        <p className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          <Warning size={16} weight="fill" className="mt-0.5 shrink-0" /> {t.counts.review.pledgeWarning}
        </p>
      ) : null}

      {findings.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-success">
          <CheckCircle size={16} weight="fill" /> {t.counts.review.none}
        </p>
      ) : (
        <ul className="space-y-2">
          {findings.map((f, i) => (
            <li key={`${f.kind}-${f.code}-${i}`} className={`rounded-xl border px-3 py-2 ${SEVERITY_TONE[exceptionSeverity(f.kind, f.reason)]}`}>
              <FindingLine f={f} t={t} />
              {f.kind === 'missing_pledge' && f.collateralItemId ? (
                <label className="mt-2 block text-xs">
                  <span className="font-semibold">{t.counts.review.pledgeNote}</span>
                  <input
                    value={notes[f.collateralItemId] ?? ''}
                    maxLength={500}
                    placeholder={t.counts.review.pledgeNotePlaceholder}
                    onChange={(e) => setNotes((n) => ({ ...n, [f.collateralItemId as string]: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-1.5 text-sm text-foreground focus:border-blue focus:outline-none"
                  />
                </label>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {error ? <p className="text-sm text-danger">{t.counts.errors[error]}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={close}
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-xl bg-gold px-4 py-2 text-sm font-bold text-navy transition-all hover:-translate-y-0.5 hover:bg-gold-2 hover:shadow-lg disabled:opacity-50"
        >
          <CheckCircle size={16} weight="bold" />
          {pending ? t.counts.review.closing : t.counts.review.close}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground hover:border-danger hover:text-danger disabled:opacity-50"
        >
          <X size={14} weight="bold" /> {t.counts.review.cancel}
        </button>
      </div>
    </section>
  )
}

// ── Closed: result + resolution ──────────────────────────────────────────

function ClosedCount({ session, exceptions, canResolve }: { session: CountSession; exceptions: StoredException[]; canResolve: boolean }) {
  const { t } = useI18n()
  const stats: Array<{ label: string; value: string; tone?: string }> = [
    { label: t.counts.summary.expected, value: String(session.expected_count ?? 0) },
    { label: t.counts.summary.seen, value: String(session.seen_count ?? 0) },
    { label: t.counts.summary.missing, value: String(session.missing_count ?? 0), tone: (session.missing_count ?? 0) > 0 ? 'text-danger' : undefined },
    { label: t.counts.summary.unexpected, value: String(session.unexpected_count ?? 0), tone: (session.unexpected_count ?? 0) > 0 ? 'text-warning' : undefined },
    { label: t.counts.summary.left, value: String(session.left_count ?? 0) },
    { label: t.counts.summary.missingValue, value: formatMoney(session.missing_value ?? 0) },
  ]

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-foreground">{t.counts.summary.title}</h2>
        <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {stats.map((x) => (
            <div key={x.label}>
              <dt className="text-xs text-muted">{x.label}</dt>
              <dd className={`font-mono text-lg font-semibold ${x.tone ?? 'text-foreground'}`}>{x.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="rounded-xl border border-border bg-card">
        <h2 className="border-b border-border px-5 py-3 text-sm font-semibold text-foreground">
          {t.counts.summary.exceptions} <span className="font-normal text-muted">({exceptions.length})</span>
        </h2>
        {exceptions.length === 0 ? (
          <p className="flex items-center gap-2 px-5 py-4 text-sm text-success">
            <CheckCircle size={16} weight="fill" /> {t.counts.summary.clean}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {exceptions.map((ex) => (
              <ExceptionRow key={ex.id} ex={ex} canResolve={canResolve} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function ExceptionRow({ ex, canResolve }: { ex: StoredException; canResolve: boolean }) {
  const { t } = useI18n()
  const [resolution, setResolution] = useState<Resolution>('found')
  const [note, setNote] = useState('')
  const [error, setError] = useState<CountError | null>(null)
  const [pending, startTransition] = useTransition()
  const severity = exceptionSeverity(ex.kind, ex.reason)
  // Only problems someone has to act on take a resolution.
  const actionable = ex.kind !== 'left_during_count'

  function save() {
    setError(null)
    startTransition(async () => {
      const res = await resolveExceptionAction({ exceptionId: ex.id, resolution, note })
      if (!res.ok) setError(res.error)
    })
  }

  return (
    <li className="space-y-2 px-5 py-3">
      <div className="flex flex-wrap items-start gap-3">
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${SEVERITY_TONE[severity]}`}>
          {t.counts.exceptionKinds[ex.kind]}
        </span>
        <div className="min-w-0 flex-1">
          <RecordLink inventoryItemId={ex.inventory_item_id} loanId={ex.loan_id} code={ex.code ?? '—'} />
          {ex.description ? <p className="truncate text-xs text-muted">{ex.description}</p> : null}
          {reasonLabel(ex.reason, t) ? <p className="text-xs text-muted">{reasonLabel(ex.reason, t)}</p> : null}
          {ex.close_note ? (
            <p className="text-xs text-foreground">
              {t.counts.resolve.closeNote}: {ex.close_note}
            </p>
          ) : null}
        </div>
        <span className="font-mono text-sm text-foreground">{ex.value > 0 ? formatMoney(ex.value) : ''}</span>
      </div>

      {ex.resolution ? (
        <p className="text-xs text-success">
          {t.counts.resolve.resolvedAs.replace('{resolution}', t.counts.resolve[ex.resolution])}
          {ex.resolution_note ? ` — ${ex.resolution_note}` : ''}
          {ex.resolved_at ? ` · ${absoluteTimestamp(ex.resolved_at)}` : ''}
        </p>
      ) : actionable && canResolve ? (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={resolution}
            onChange={(e) => setResolution(e.target.value as Resolution)}
            className="rounded-xl border border-border bg-card px-3 py-1.5 text-sm text-foreground"
          >
            {RESOLUTIONS.map((r) => (
              <option key={r} value={r}>{t.counts.resolve[r]}</option>
            ))}
          </select>
          <input
            value={note}
            maxLength={500}
            placeholder={t.counts.resolve.notePlaceholder}
            aria-label={t.counts.resolve.note}
            onChange={(e) => setNote(e.target.value)}
            className="min-w-48 flex-1 rounded-xl border border-border bg-card px-3 py-1.5 text-sm text-foreground focus:border-blue focus:outline-none"
          />
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="rounded-xl border border-border bg-card px-3 py-1.5 text-sm font-semibold text-foreground hover:border-blue hover:text-blue disabled:opacity-50"
          >
            {t.counts.resolve.save}
          </button>
          {error ? <span className="text-xs text-danger">{t.counts.errors[error]}</span> : null}
        </div>
      ) : actionable ? (
        <p className="text-xs text-warning">{t.counts.resolve.open}</p>
      ) : null}
    </li>
  )
}

// ── Shared bits ──────────────────────────────────────────────────────────

function FindingLine({ f, t }: { f: Finding; t: Dictionary }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="text-xs font-semibold">{t.counts.exceptionKinds[f.kind as ExceptionKind]}</span>
      <RecordLink inventoryItemId={f.inventoryItemId} loanId={f.loanId} code={f.code ?? '—'} />
      {f.description ? <span className="min-w-0 truncate text-xs text-foreground">{f.description}</span> : null}
      {reasonLabel(f.reason, t) ? <span className="text-xs">{reasonLabel(f.reason, t)}</span> : null}
    </div>
  )
}

function RecordLink({ inventoryItemId, loanId, code }: { inventoryItemId: string | null; loanId: string | null; code: string }) {
  const href = inventoryItemId ? `/inventory/${inventoryItemId}` : loanId ? `/pawn/${loanId}` : null
  return href ? (
    <Link href={href} className="font-mono text-sm text-blue hover:text-blue-2">
      {code}
    </Link>
  ) : (
    <span className="font-mono text-sm text-foreground">{code}</span>
  )
}
