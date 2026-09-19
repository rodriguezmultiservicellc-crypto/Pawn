'use client'

import { useActionState, useState } from 'react'
import { ShieldCheck, ShieldWarning, ArrowClockwise } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import type { OfacMatch } from '@/lib/compliance/ofac/match'
import {
  reviewOfacScreeningAction,
  screenCustomerNowAction,
  type OfacActionResult,
} from '@/app/(staff)/customers/[id]/ofac-actions'

export type OfacScreeningView = {
  id: string
  result: 'clear' | 'potential_match' | 'unavailable'
  reviewStatus: 'not_required' | 'pending' | 'cleared' | 'confirmed'
  reviewNote: string | null
  reviewedAt: string | null
  createdAt: string
  listFetchedAt: string | null
  matches: OfacMatch[]
  carried: boolean
}

/**
 * Customer detail → OFAC screening status. Staff can re-screen; owners /
 * managers resolve a pending potential match (false positive vs confirmed —
 * confirming also bans the customer).
 */
export function OfacPanel({
  customerId,
  enabled,
  latest,
  canReview,
}: {
  customerId: string
  enabled: boolean
  latest: OfacScreeningView | null
  canReview: boolean
}) {
  const { t } = useI18n()
  const to = t.ofac.panel
  const [screenState, screenAction, screening] = useActionState<OfacActionResult, FormData>(
    screenCustomerNowAction,
    {},
  )

  const tone =
    !latest || latest.result === 'unavailable'
      ? 'border-border bg-background text-muted'
      : latest.reviewStatus === 'pending' || latest.reviewStatus === 'confirmed'
      ? 'border-danger/30 bg-danger/5 text-danger'
      : latest.result === 'potential_match'
      ? 'border-warning/30 bg-warning/5 text-warning'
      : 'border-success/30 bg-success/5 text-success'

  const status = !latest
    ? to.statusNever
    : latest.result === 'unavailable'
    ? to.statusUnavailable
    : latest.reviewStatus === 'pending'
    ? to.statusPending
    : latest.reviewStatus === 'confirmed'
    ? to.statusConfirmed
    : latest.reviewStatus === 'cleared'
    ? latest.carried
      ? to.statusCarried
      : to.statusCleared
    : to.statusClear

  const blocking = latest?.reviewStatus === 'pending' || latest?.reviewStatus === 'confirmed'

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${
              blocking ? 'bg-danger/10 text-danger' : 'bg-blue/10 text-blue'
            }`}
          >
            {blocking ? <ShieldWarning size={18} weight="bold" /> : <ShieldCheck size={18} weight="bold" />}
          </span>
          <div>
            <h2 className="text-sm font-semibold text-foreground">{to.title}</h2>
            <p className="text-xs text-muted">
              {enabled ? to.subtitle : to.disabled}
            </p>
          </div>
        </div>
        <form action={screenAction}>
          <input type="hidden" name="customer_id" value={customerId} />
          <button
            type="submit"
            disabled={screening}
            className="inline-flex items-center gap-1 rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground hover:bg-background disabled:opacity-50"
          >
            <ArrowClockwise size={14} weight="bold" />
            {screening ? to.screening : to.screenNow}
          </button>
        </form>
      </div>

      <div className={`mt-3 rounded-lg border px-3 py-2 text-sm font-semibold ${tone}`}>
        {status}
      </div>
      {screenState.error ? (
        <p className="mt-2 text-xs text-danger">{screenState.error}</p>
      ) : null}

      {latest ? (
        <p className="mt-2 text-xs text-muted">
          {to.screenedOn
            .replace('{date}', latest.createdAt.slice(0, 10))
            .replace('{list}', latest.listFetchedAt ? latest.listFetchedAt.slice(0, 10) : '—')}
        </p>
      ) : null}

      {latest && latest.matches.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="py-1 pr-3">{to.colName}</th>
                <th className="py-1 pr-3">{to.colPrograms}</th>
                <th className="py-1 pr-3">{to.colDob}</th>
                <th className="py-1 text-right">{to.colScore}</th>
              </tr>
            </thead>
            <tbody>
              {latest.matches.map((m) => (
                <tr key={`${m.ent_num}-${m.name}`} className="border-t border-border">
                  <td className="py-1.5 pr-3 text-foreground">
                    {m.name}
                    {m.is_alias ? (
                      <span className="ml-1 text-xs text-muted">({to.alias})</span>
                    ) : null}
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-xs">{m.programs ?? '—'}</td>
                  <td className="py-1.5 pr-3 font-mono text-xs">
                    {m.dob_years.length ? m.dob_years.join(', ') : '—'}
                    {m.dob_conflict ? (
                      <span className="ml-1 font-sans text-muted">({to.dobConflict})</span>
                    ) : null}
                  </td>
                  <td className="py-1.5 text-right font-mono text-xs">
                    {(m.score * 100).toFixed(0)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {latest?.reviewNote && latest.reviewStatus !== 'pending' && !latest.carried ? (
        <p className="mt-2 text-xs text-muted">
          {to.reviewNote}: {latest.reviewNote}
        </p>
      ) : null}

      {latest?.reviewStatus === 'pending' ? (
        canReview ? (
          <ReviewForm screeningId={latest.id} />
        ) : (
          <p className="mt-3 text-xs text-muted">{to.managerOnly}</p>
        )
      ) : null}
    </section>
  )
}

function ReviewForm({ screeningId }: { screeningId: string }) {
  const { t } = useI18n()
  const to = t.ofac.panel
  const [state, action, pending] = useActionState<OfacActionResult, FormData>(
    reviewOfacScreeningAction,
    {},
  )
  const [decision, setDecision] = useState<'cleared' | 'confirmed'>('cleared')

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (decision === 'confirmed' && !confirm(to.confirmPrompt)) e.preventDefault()
      }}
      className="mt-4 space-y-3 rounded-lg border border-border bg-background p-3"
    >
      <input type="hidden" name="screening_id" value={screeningId} />
      <input type="hidden" name="decision" value={decision} />
      <p className="text-sm font-semibold text-foreground">{to.reviewTitle}</p>
      <p className="text-xs text-muted">{to.reviewHelp}</p>
      <div className="flex flex-wrap gap-2">
        {(['cleared', 'confirmed'] as const).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDecision(d)}
            className={`rounded-xl border-2 px-3 py-1.5 text-sm font-semibold ${
              decision === d
                ? d === 'confirmed'
                  ? 'border-danger bg-danger/10 text-danger'
                  : 'border-blue bg-blue/10 text-blue'
                : 'border-border text-foreground'
            }`}
          >
            {d === 'cleared' ? to.decisionCleared : to.decisionConfirmed}
          </button>
        ))}
      </div>
      <textarea
        name="note"
        required
        minLength={10}
        rows={3}
        placeholder={to.notePlaceholder}
        className="block w-full rounded-xl border-2 border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-blue"
      />
      {state.error ? (
        <p className="text-xs text-danger">
          {state.error === 'note_required' ? to.noteRequired : state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-xl bg-gold px-4 py-2 text-sm font-bold text-navy transition-all hover:-translate-y-0.5 hover:bg-gold-2 hover:shadow-lg disabled:opacity-50"
      >
        {pending ? t.common.saving : to.submitReview}
      </button>
    </form>
  )
}
