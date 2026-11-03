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

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <LinkSimple size={16} weight="bold" />
          {tr.title}
        </h2>
        <p className="text-xs text-muted">{tr.help}</p>
      </header>

      <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-2">
        {/* Link */}
        <div className="space-y-2">
          {currentLink ? (
            <>
              <input
                readOnly
                value={currentLink}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground"
                aria-label={tr.title}
              />
              <div className="flex flex-wrap items-center gap-2">
                <SmallButton onClick={copyLink} icon={<Copy size={14} weight="bold" />}>
                  {notice === 'copied' ? tr.copied : tr.copy}
                </SmallButton>
                <a
                  href={currentLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-background"
                >
                  <ArrowSquareOut size={14} weight="bold" />
                  {tr.open}
                </a>
                <SmallButton
                  onClick={() => run(sendTrackingLinkAction, {}, () => setNotice('sent'))}
                  disabled={pending}
                  icon={<ChatText size={14} weight="bold" />}
                  primary
                >
                  {pending ? tr.sending : notice === 'sent' ? tr.sent : tr.sendSms}
                </SmallButton>
                <SmallButton
                  onClick={() => {
                    if (window.confirm(tr.regenerateConfirm)) {
                      run(regenerateTrackingLinkAction, {}, (res) =>
                        setCurrentLink(res.link ?? null),
                      )
                    }
                  }}
                  disabled={pending}
                  icon={<LinkSimple size={14} weight="bold" />}
                >
                  {tr.regenerate}
                </SmallButton>
                <SmallButton
                  onClick={() => {
                    if (window.confirm(tr.revokeConfirm)) {
                      run(revokeTrackingLinkAction, {}, () => setCurrentLink(null))
                    }
                  }}
                  disabled={pending}
                  icon={<LinkBreak size={14} weight="bold" />}
                  tone="danger"
                >
                  {tr.revoke}
                </SmallButton>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted">{tr.revoked}</p>
              <SmallButton
                onClick={() =>
                  run(regenerateTrackingLinkAction, {}, (res) =>
                    setCurrentLink(res.link ?? null),
                  )
                }
                disabled={pending}
                icon={<LinkSimple size={14} weight="bold" />}
                primary
              >
                {tr.regenerate}
              </SmallButton>
            </>
          )}
        </div>

        {/* Stage */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs uppercase tracking-wide text-muted">{tr.stageTitle}</div>
            <Link
              href="/settings/repair-stages"
              className="text-xs text-blue hover:underline"
            >
              {tr.manageStages}
            </Link>
          </div>
          {ordered.length === 0 ? (
            <p className="text-sm text-muted">{tr.stagesMissing}</p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <div className="text-base font-semibold text-foreground">
                  {current ? stageName(current, lang) : tr.stageNone}
                </div>
                <div className="font-mono text-xs text-muted">
                  {progressPercent(current)}%
                </div>
              </div>
              <div
                className="h-2 w-full overflow-hidden rounded-full bg-background"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progressPercent(current)}
              >
                <div
                  className="h-full rounded-full bg-gold transition-[width]"
                  style={{ width: `${progressPercent(current)}%` }}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <SmallButton
                  onClick={() => run(setPublicStageAction, { stage_id: 'next' })}
                  disabled={pending || atLast || isTerminal}
                  icon={<ArrowRight size={14} weight="bold" />}
                  primary
                >
                  {atLast ? tr.lastStage : tr.nextStage}
                </SmallButton>
                <select
                  value={currentStageId ?? ''}
                  onChange={(e) => run(setPublicStageAction, { stage_id: e.target.value })}
                  disabled={pending || isTerminal}
                  aria-label={tr.setStage}
                  className="h-8 rounded-md border border-border bg-card px-2 text-xs text-foreground"
                >
                  <option value="" disabled>
                    {tr.setStage}
                  </option>
                  {ordered.map((s) => (
                    <option key={s.id} value={s.id}>
                      {stageName(s, lang)} · {s.percent}%
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-[11px] text-muted">{tr.autoAdvanceNote}</p>
            </>
          )}
        </div>
      </div>

      {errorText ? (
        <div className="border-t border-border px-4 py-2 text-sm text-danger" role="alert">
          {errorText}
        </div>
      ) : null}
    </section>
  )
}

function SmallButton({
  children,
  onClick,
  disabled,
  icon,
  primary,
  tone,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  icon: React.ReactNode
  primary?: boolean
  tone?: 'danger'
}) {
  let cls =
    'inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50'
  if (primary) cls += ' border-gold bg-gold text-navy hover:bg-gold-2'
  else if (tone === 'danger') cls += ' border-danger/30 bg-danger/5 text-danger hover:bg-danger/10'
  else cls += ' border-border bg-card text-foreground hover:bg-background'
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cls}>
      {icon}
      {children}
    </button>
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
