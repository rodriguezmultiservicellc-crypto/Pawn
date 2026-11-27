'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import {
  ArrowRight,
  ArrowSquareOut,
  ChatText,
  Check,
  Copy,
  LinkBreak,
  LinkSimple,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { FOCUS, OUTLINE_BTN } from '@/lib/ui/ledger'
import {
  progressPercent,
  sortStages,
  stageIndex,
  stageName,
  type RepairStageLite,
} from '@/lib/repair/stages'
import {
  regenerateTrackingLinkAction,
  revokeTrackingLinkAction,
  sendTrackingLinkAction,
  setPublicStageAction,
  type StageActionResult,
} from '@/app/(staff)/repair/stage-actions'

/**
 * Ticket-detail panel: the customer's tracking link (copy / open / SMS /
 * regenerate / revoke) and the customer-facing stage (progress bar, next
 * stage, pick a stage). Lives on the staff side; the public page it points
 * to is /t/<token>.
 */
export function TrackingPanel({
  ticketId,
  link,
  stages,
  currentStageId,
  isTerminal,
}: {
  ticketId: string
  link: string | null
  stages: RepairStageLite[]
  currentStageId: string | null
  isTerminal: boolean
}) {
  const { t, lang } = useI18n()
  const tr = t.repair.tracking
  const [pending, startTransition] = useTransition()
  const [currentLink, setCurrentLink] = useState<string | null>(link)
  const [notice, setNotice] = useState<'copied' | 'sent' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const ordered = sortStages(stages)
  const current = ordered.find((s) => s.id === currentStageId) ?? null
  const idx = stageIndex(ordered, currentStageId)
  const atLast = ordered.length > 0 && idx === ordered.length - 1

  function run(
    action: (fd: FormData) => Promise<StageActionResult>,
    extra: Record<string, string> = {},
    onOk?: (res: StageActionResult) => void,
  ) {
    setError(null)
    setNotice(null)
    const fd = new FormData()
    fd.set('ticket_id', ticketId)
    for (const [k, v] of Object.entries(extra)) fd.set(k, v)
    startTransition(async () => {
      const res = await action(fd)
      if (res.error) setError(res.error)
      else onOk?.(res)
    })
  }

  async function copyLink() {
    if (!currentLink) return
    try {
      await navigator.clipboard.writeText(currentLink)
      setNotice('copied')
    } catch {
      // Clipboard blocked (http / permissions) — the input below is selectable.
      setNotice(null)
    }
  }

  const errorText =
    error == null
      ? null
      : (tr.errors as Record<string, string>)[error] ?? error

  const pct = progressPercent(current)
  const textBtn = `inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-[13px] font-bold hover:underline disabled:opacity-50 ${FOCUS}`

  // Compact, for the ticket page's side column. The help sentence is the
  // card's tooltip; the URL itself is read by screen readers only (Copy
  // link puts it on the clipboard).
  return (
    <section className="rounded-xl border border-border bg-card px-4 py-4" title={tr.help}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[12px] font-bold uppercase tracking-wide text-text-secondary">
          {t.repair.detail.customerSees}
        </h2>
        <Link href="/settings/repair-stages" className="text-[13px] font-semibold text-blue hover:underline">
          {tr.manageStages}
        </Link>
      </div>

      {ordered.length === 0 ? (
        <p className="mt-1 text-sm text-text-secondary">{tr.stagesMissing}</p>
      ) : (
        <>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <span className="font-bold text-foreground">
              {current ? stageName(current, lang) : tr.stageNone}
            </span>
            <span className="font-mono text-sm text-text-secondary">{pct}%</span>
          </div>
          <div
            className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-border"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-label={t.repair.detail.customerSees}
          >
            <div className="h-full rounded-full bg-blue transition-[width]" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              value={currentStageId ?? ''}
              onChange={(e) => run(setPublicStageAction, { stage_id: e.target.value })}
              disabled={pending || isTerminal}
              aria-label={tr.setStage}
              className={`h-9 min-w-0 flex-1 rounded-md border border-border bg-card px-2 text-sm text-foreground disabled:opacity-50 ${FOCUS}`}
            >
              <option value="" disabled>
                {tr.setStage}
              </option>
              {ordered.map((st) => (
                <option key={st.id} value={st.id}>
                  {stageName(st, lang)} · {st.percent}%
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => run(setPublicStageAction, { stage_id: 'next' })}
              disabled={pending || atLast || isTerminal}
              title={tr.autoAdvanceNote}
              className={`${OUTLINE_BTN} h-9 px-3`}
            >
              <ArrowRight size={14} weight="bold" />
              {atLast ? tr.lastStage : tr.nextStage}
            </button>
          </div>
        </>
      )}

      <div className="mt-4 border-t border-border pt-3">
        {currentLink ? (
          <>
            <span className="sr-only">{currentLink}</span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => run(sendTrackingLinkAction, {}, () => setNotice('sent'))}
                disabled={pending}
                className={`${OUTLINE_BTN} flex-1`}
              >
                <ChatText size={16} weight="bold" />
                {pending ? tr.sending : notice === 'sent' ? tr.sent : tr.sendSms}
              </button>
              <button type="button" onClick={copyLink} title={currentLink} className={`${OUTLINE_BTN} flex-1`}>
                <Copy size={16} weight="bold" />
                {notice === 'copied' ? tr.copied : tr.copy}
              </button>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <a href={currentLink} target="_blank" rel="noopener noreferrer" className={`${textBtn} text-blue`}>
                <ArrowSquareOut size={14} weight="bold" />
                {tr.open}
              </a>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(tr.regenerateConfirm)) {
                    run(regenerateTrackingLinkAction, {}, (res) => setCurrentLink(res.link ?? null))
                  }
                }}
                disabled={pending}
                className={`${textBtn} text-blue`}
              >
                <LinkSimple size={14} weight="bold" />
                {tr.regenerate}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(tr.revokeConfirm)) {
                    run(revokeTrackingLinkAction, {}, () => setCurrentLink(null))
                  }
                }}
                disabled={pending}
                className={`${textBtn} text-danger`}
              >
                <LinkBreak size={14} weight="bold" />
                {tr.revoke}
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-text-secondary">{tr.revoked}</p>
            <button
              type="button"
              onClick={() => run(regenerateTrackingLinkAction, {}, (res) => setCurrentLink(res.link ?? null))}
              disabled={pending}
              className={OUTLINE_BTN}
            >
              <LinkSimple size={16} weight="bold" />
              {tr.regenerate}
            </button>
          </div>
        )}
      </div>

      {errorText ? (
        <p className="mt-2 text-sm text-danger" role="alert">
          {errorText}
        </p>
      ) : null}
    </section>
  )
}

/** Compact variant for the work-order board card footer. */
export function StageQuickRow({
  ticketId,
  stages,
  currentStageId,
  onMoved,
}: {
  ticketId: string
  stages: RepairStageLite[]
  currentStageId: string | null
  onMoved: () => void
}) {
  const { t, lang } = useI18n()
  const tr = t.repair.tracking
  const [pending, startTransition] = useTransition()
  const ordered = sortStages(stages)
  const current = ordered.find((s) => s.id === currentStageId) ?? null
  const idx = stageIndex(ordered, currentStageId)
  const atLast = ordered.length > 0 && idx === ordered.length - 1
  if (ordered.length === 0) return null

  return (
    <div className="mt-1 flex items-center justify-between gap-2 rounded-md border border-border bg-background/60 px-2 py-1 text-[11px]">
      <span className="truncate text-muted">
        {current ? stageName(current, lang) : tr.stageNone}
        <span className="ml-1 font-mono">{progressPercent(current)}%</span>
      </span>
      <button
        type="button"
        disabled={pending || atLast}
        onClick={() => {
          const fd = new FormData()
          fd.set('ticket_id', ticketId)
          fd.set('stage_id', 'next')
          startTransition(async () => {
            const res = await setPublicStageAction(fd)
            if (!res.error) onMoved()
          })
        }}
        className="inline-flex shrink-0 items-center gap-1 rounded border border-gold/40 bg-gold/10 px-1.5 py-0.5 font-medium text-foreground hover:bg-gold/20 disabled:opacity-40"
        title={tr.nextStage}
      >
        {atLast ? <Check size={10} weight="bold" /> : <ArrowRight size={10} weight="bold" />}
        {tr.nextStage}
      </button>
    </div>
  )
}
