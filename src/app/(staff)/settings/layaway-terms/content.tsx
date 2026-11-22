'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { ArrowDown, ArrowLeft, ArrowUp, PencilSimple, Star, Trash } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { Modal, Footer } from '@/components/pos/Modal'
import {
  LAYAWAY_SCHEDULE_KINDS,
  LAYAWAY_TERMS_MAX,
  fractionToPercent,
  type LayawayTerm,
  type LayawayTermInput,
} from '@/lib/pos/layaway-terms'
import type { LayawayScheduleKind } from '@/types/database-aliases'
import {
  createLayawayTermAction,
  moveLayawayTermAction,
  removeLayawayTermAction,
  setDefaultLayawayTermAction,
  updateLayawayTermAction,
} from './actions'

type Draft = {
  name: string
  schedule_kind: LayawayScheduleKind
  down_payment_percent: string
  first_payment_days: string
  term_days: string
  cancellation_fee_percent: string
  is_active: boolean
}

const BLANK: Draft = {
  name: '',
  schedule_kind: 'weekly',
  down_payment_percent: '',
  first_payment_days: '',
  term_days: '',
  cancellation_fee_percent: '',
  is_active: true,
}

function draftOf(term: LayawayTerm): Draft {
  return {
    name: term.name,
    schedule_kind: term.schedule_kind,
    down_payment_percent: fractionToPercent(term.down_payment_pct),
    first_payment_days: String(term.first_payment_days),
    term_days: String(term.term_days),
    cancellation_fee_percent: fractionToPercent(term.cancellation_fee_pct),
    is_active: term.is_active,
  }
}

const inputCls =
  'block h-11 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground focus:border-blue focus:outline-none focus-visible:outline-3 focus-visible:outline-blue'
const goldBtn =
  'h-11 rounded-xl bg-gold px-5 text-sm font-bold text-navy transition-all hover:-translate-y-0.5 hover:bg-gold-2 hover:shadow-lg disabled:opacity-50'
const iconBtn =
  'grid h-11 w-11 place-items-center rounded-md border border-border text-foreground hover:bg-background disabled:opacity-40'

type ActionResult = Awaited<ReturnType<typeof createLayawayTermAction>>

export default function LayawayTermsContent({ terms }: { terms: LayawayTerm[] }) {
  const { t } = useI18n()
  const lt = t.layawayTerms
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [draft, setDraft] = useState<Draft>(BLANK)
  const [editing, setEditing] = useState<{ id: string; draft: Draft } | null>(null)
  const full = terms.length >= LAYAWAY_TERMS_MAX

  const errorText = (code: Exclude<ActionResult, { ok: true }>['error']) =>
    lt.errors[code].replace('{max}', String(LAYAWAY_TERMS_MAX))

  const run = (fn: () => Promise<ActionResult>, onOk?: () => void) => {
    setMsg(null)
    start(async () => {
      const r = await fn()
      if (r.ok) {
        onOk?.()
        setMsg({ ok: true, text: lt.saved })
      } else setMsg({ ok: false, text: errorText(r.error) })
    })
  }

  const scheduleLabel = (kind: LayawayScheduleKind) =>
    ({
      weekly: t.pos.layaway.scheduleWeekly,
      biweekly: t.pos.layaway.scheduleBiweekly,
      monthly: t.pos.layaway.scheduleMonthly,
      custom: t.pos.layaway.scheduleCustom,
    })[kind]

  const summary = (term: LayawayTerm) =>
    lt.summary
      .replace('{schedule}', scheduleLabel(term.schedule_kind))
      .replace('{down}', fractionToPercent(term.down_payment_pct))
      .replace('{first}', String(term.first_payment_days))
      .replace('{term}', String(term.term_days))
      .replace('{fee}', fractionToPercent(term.cancellation_fee_pct))

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft size={14} weight="bold" />
          {t.common.backToSettings}
        </Link>
        <h1 className="mt-2 font-display text-2xl font-bold text-foreground">{lt.title}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">{lt.subtitle}</p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          run(() => createLayawayTermAction(draft as LayawayTermInput), () => setDraft(BLANK))
        }}
        className="space-y-4 rounded-xl border border-border bg-card p-5"
      >
        <h2 className="text-sm font-semibold text-foreground">{lt.addTitle}</h2>
        <TermFields draft={draft} onChange={setDraft} scheduleLabel={scheduleLabel} />
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={pending || full} className={goldBtn}>
            {lt.add}
          </button>
          {full ? <span className="text-sm text-muted">{errorText('limit')}</span> : null}
          {msg && !editing ? (
            <span role={msg.ok ? 'status' : 'alert'} className={`text-sm ${msg.ok ? 'text-success' : 'text-danger'}`}>
              {msg.text}
            </span>
          ) : null}
        </div>
      </form>

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        {terms.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted">{lt.empty}</p>
        ) : (
          <ul>
            {terms.map((term, i) => (
              <li
                key={term.id}
                className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`font-semibold ${term.is_active ? 'text-foreground' : 'text-muted'}`}>
                      {term.name}
                    </span>
                    {term.is_default ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-gold/15 px-2 py-0.5 text-xs font-semibold text-foreground">
                        <Star size={12} weight="fill" className="text-gold" />
                        {lt.default}
                      </span>
                    ) : null}
                    {!term.is_active ? (
                      <span className="rounded-full bg-background px-2 py-0.5 text-xs font-semibold text-muted">
                        {lt.off}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-sm text-muted">{summary(term)}</p>
                </div>
                {!term.is_default && term.is_active ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => setDefaultLayawayTermAction(term.id))}
                    className="h-11 rounded-md border border-border px-4 text-sm font-semibold text-foreground hover:bg-background disabled:opacity-40"
                  >
                    {lt.makeDefault}
                  </button>
                ) : null}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      setMsg(null)
                      setEditing({ id: term.id, draft: draftOf(term) })
                    }}
                    aria-label={`${t.common.edit} — ${term.name}`}
                    className={iconBtn}
                  >
                    <PencilSimple size={16} />
                  </button>
                  <button
                    type="button"
                    disabled={pending || i === 0}
                    onClick={() => run(() => moveLayawayTermAction(term.id, -1))}
                    aria-label={`${lt.moveUp} — ${term.name}`}
                    className={iconBtn}
                  >
                    <ArrowUp size={16} />
                  </button>
                  <button
                    type="button"
                    disabled={pending || i === terms.length - 1}
                    onClick={() => run(() => moveLayawayTermAction(term.id, 1))}
                    aria-label={`${lt.moveDown} — ${term.name}`}
                    className={iconBtn}
                  >
                    <ArrowDown size={16} />
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      if (confirm(lt.removeConfirm.replace('{name}', term.name))) {
                        run(() => removeLayawayTermAction(term.id))
                      }
                    }}
                    aria-label={`${lt.remove} — ${term.name}`}
                    className={`${iconBtn} text-danger`}
                  >
                    <Trash size={16} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editing ? (
        <Modal title={lt.editTitle} onClose={() => setEditing(null)} size="lg">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              run(
                () => updateLayawayTermAction(editing.id, editing.draft as LayawayTermInput),
                () => setEditing(null),
              )
            }}
          >
            {msg && !msg.ok ? (
              <div role="alert" className="mb-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
                {msg.text}
              </div>
            ) : null}
            <TermFields
              draft={editing.draft}
              onChange={(d) => setEditing({ id: editing.id, draft: d })}
              scheduleLabel={scheduleLabel}
              showActive
            />
            <Footer>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-md border border-border bg-card px-4 py-2 text-sm text-foreground hover:bg-background"
              >
                {t.common.cancel}
              </button>
              <button
                type="submit"
                disabled={pending}
                className="rounded-md bg-gold px-4 py-2 text-sm font-medium text-navy hover:bg-gold-2 disabled:opacity-50"
              >
                {pending ? t.common.saving : lt.save}
              </button>
            </Footer>
          </form>
        </Modal>
      ) : null}
    </div>
  )
}

function TermFields({
  draft,
  onChange,
  scheduleLabel,
  showActive = false,
}: {
  draft: Draft
  onChange: (d: Draft) => void
  scheduleLabel: (kind: LayawayScheduleKind) => string
  showActive?: boolean
}) {
  const { t } = useI18n()
  const lt = t.layawayTerms
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => onChange({ ...draft, [key]: value })
  const label = 'block text-sm font-semibold text-foreground'

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block space-y-1">
          <span className={label}>{lt.name}</span>
          <input
            required
            maxLength={60}
            value={draft.name}
            placeholder={lt.namePlaceholder}
            onChange={(e) => set('name', e.target.value)}
            className={inputCls}
          />
        </label>
        <label className="block space-y-1">
          <span className={label}>{t.pos.layaway.schedule}</span>
          <select
            value={draft.schedule_kind}
            onChange={(e) => set('schedule_kind', e.target.value as LayawayScheduleKind)}
            className={inputCls}
          >
            {LAYAWAY_SCHEDULE_KINDS.map((k) => (
              <option key={k} value={k}>
                {scheduleLabel(k)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block space-y-1">
          <span className={label}>{lt.downPaymentPercent}</span>
          <input
            required
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            max="100"
            value={draft.down_payment_percent}
            onChange={(e) => set('down_payment_percent', e.target.value)}
            className={`${inputCls} font-mono`}
          />
          <span className="block text-xs text-muted">{lt.downPaymentPercentHelp}</span>
        </label>
        <label className="block space-y-1">
          <span className={label}>{lt.cancellationFeePercent}</span>
          <input
            required
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            max="100"
            value={draft.cancellation_fee_percent}
            onChange={(e) => set('cancellation_fee_percent', e.target.value)}
            className={`${inputCls} font-mono`}
          />
          <span className="block text-xs text-muted">{lt.cancellationFeePercentHelp}</span>
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block space-y-1">
          <span className={label}>{lt.firstPaymentDays}</span>
          <input
            required
            type="number"
            inputMode="numeric"
            step="1"
            min="1"
            max="366"
            value={draft.first_payment_days}
            onChange={(e) => set('first_payment_days', e.target.value)}
            className={`${inputCls} font-mono`}
          />
        </label>
        <label className="block space-y-1">
          <span className={label}>{lt.termDays}</span>
          <input
            required
            type="number"
            inputMode="numeric"
            step="1"
            min="1"
            max="1096"
            value={draft.term_days}
            onChange={(e) => set('term_days', e.target.value)}
            className={`${inputCls} font-mono`}
          />
        </label>
      </div>

      {showActive ? (
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={draft.is_active}
            onChange={(e) => set('is_active', e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          {lt.active}
        </label>
      ) : null}
    </div>
  )
}
