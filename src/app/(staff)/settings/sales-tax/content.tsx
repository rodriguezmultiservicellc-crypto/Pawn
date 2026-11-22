'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { ArrowLeft, Trash } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { fractionToPercent } from '@/lib/format/money'
import {
  SALES_TAX_MAX,
  TAX_LEVELS,
  taxBreakdown,
  totalTaxRate,
  type TaxLevel,
  type TaxRate,
  type TaxRateInput,
} from '@/lib/pos/sales-tax'
import { createTaxRateAction, removeTaxRateAction, updateTaxRateAction } from './actions'

type Draft = { name: string; level: TaxLevel; percent: string; is_active: boolean }

const BLANK: Draft = { name: '', level: 'state', percent: '', is_active: true }

const inputCls =
  'h-11 rounded-md border border-border bg-card px-3 text-sm text-foreground focus:border-blue focus:outline-none focus-visible:outline-3 focus-visible:outline-blue'
const goldBtn =
  'h-11 rounded-xl bg-gold px-5 text-sm font-bold text-navy transition-all hover:-translate-y-0.5 hover:bg-gold-2 hover:shadow-lg disabled:opacity-50'

type ActionResult = Awaited<ReturnType<typeof createTaxRateAction>>

export default function SalesTaxContent({ rates }: { rates: TaxRate[] }) {
  const { t } = useI18n()
  const st = t.salesTax
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [draft, setDraft] = useState<Draft>(BLANK)
  const full = rates.length >= SALES_TAX_MAX
  const total = totalTaxRate(rates)
  const breakdown = taxBreakdown(rates)

  const errorText = (code: Exclude<ActionResult, { ok: true }>['error']) =>
    st.errors[code].replace('{max}', String(SALES_TAX_MAX))

  const run = (fn: () => Promise<ActionResult>, onOk?: () => void) => {
    setMsg(null)
    start(async () => {
      const r = await fn()
      if (r.ok) {
        onOk?.()
        setMsg({ ok: true, text: st.saved })
      } else setMsg({ ok: false, text: errorText(r.error) })
    })
  }

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
        <h1 className="mt-2 font-display text-2xl font-bold text-foreground">{st.title}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">{st.subtitle}</p>
      </div>

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="text-sm font-semibold text-foreground">{st.total}</span>
          <span className="font-mono text-3xl font-bold text-foreground" data-testid="tax-total">
            {fractionToPercent(total)}%
          </span>
          {total > 0 ? (
            breakdown.includes(' + ') ? <span className="text-sm text-muted">{breakdown}</span> : null
          ) : (
            <span className="text-sm font-semibold text-warning">{st.totalNone}</span>
          )}
        </div>
        <p className="mt-2 max-w-3xl text-xs text-muted">{st.uses}</p>
      </section>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          run(() => createTaxRateAction(draft as TaxRateInput), () => setDraft(BLANK))
        }}
        className="space-y-4 rounded-xl border border-border bg-card p-5"
      >
        <h2 className="text-sm font-semibold text-foreground">{st.addTitle}</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block space-y-1 text-sm">
            <span className="block font-semibold text-foreground">{st.name}</span>
            <input
              required
              maxLength={60}
              value={draft.name}
              placeholder={st.namePlaceholder}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              className={`${inputCls} w-64`}
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="block font-semibold text-foreground">{st.level}</span>
            <select
              value={draft.level}
              onChange={(e) => setDraft((d) => ({ ...d, level: e.target.value as TaxLevel }))}
              className={`${inputCls} w-44`}
            >
              {TAX_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {st.levels[l]}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            <span className="block font-semibold text-foreground">{st.rate}</span>
            <input
              required
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0.01"
              max="100"
              value={draft.percent}
              onChange={(e) => setDraft((d) => ({ ...d, percent: e.target.value }))}
              className={`${inputCls} w-28 text-right font-mono`}
            />
          </label>
          <button type="submit" disabled={pending || full} className={goldBtn}>
            {st.add}
          </button>
          {full ? <span className="text-sm text-muted">{errorText('limit')}</span> : null}
          {msg ? (
            <span role={msg.ok ? 'status' : 'alert'} className={`text-sm ${msg.ok ? 'text-success' : 'text-danger'}`}>
              {msg.text}
            </span>
          ) : null}
        </div>
      </form>

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        {rates.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted">{st.empty}</p>
        ) : (
          <ul>
            {rates.map((r) => (
              <Row
                // A saved change gives the row new values; start its fields from them.
                key={`${r.id}:${r.name}:${r.level}:${r.rate}:${r.is_active}`}
                rate={r}
                pending={pending}
                onSave={(v) => run(() => updateTaxRateAction(r.id, v as TaxRateInput))}
                onRemove={() => {
                  if (confirm(st.removeConfirm.replace('{name}', r.name))) run(() => removeTaxRateAction(r.id))
                }}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Row({
  rate,
  pending,
  onSave,
  onRemove,
}: {
  rate: TaxRate
  pending: boolean
  onSave: (v: Draft) => void
  onRemove: () => void
}) {
  const { t } = useI18n()
  const st = t.salesTax
  const saved: Draft = {
    name: rate.name,
    level: rate.level,
    percent: fractionToPercent(rate.rate),
    is_active: rate.is_active,
  }
  const [v, setV] = useState<Draft>(saved)
  const dirty =
    v.name !== saved.name ||
    v.level !== saved.level ||
    v.is_active !== saved.is_active ||
    Number(v.percent) !== Number(saved.percent)

  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3 last:border-b-0">
      <input
        maxLength={60}
        value={v.name}
        onChange={(e) => setV((d) => ({ ...d, name: e.target.value }))}
        aria-label={st.name}
        className={`${inputCls} w-64`}
      />
      <select
        value={v.level}
        onChange={(e) => setV((d) => ({ ...d, level: e.target.value as TaxLevel }))}
        aria-label={st.level}
        className={`${inputCls} w-44`}
      >
        {TAX_LEVELS.map((l) => (
          <option key={l} value={l}>
            {st.levels[l]}
          </option>
        ))}
      </select>
      <span className="inline-flex items-center gap-1 text-sm text-muted">
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0.01"
          max="100"
          value={v.percent}
          onChange={(e) => setV((d) => ({ ...d, percent: e.target.value }))}
          aria-label={st.rate}
          className={`${inputCls} w-28 text-right font-mono`}
        />
        %
      </span>
      <label className="flex h-11 items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={v.is_active}
          onChange={(e) => setV((d) => ({ ...d, is_active: e.target.checked }))}
        />
        {st.active}
      </label>
      <button
        type="button"
        disabled={pending || !dirty}
        onClick={() => onSave(v)}
        className="h-11 rounded-md border border-border px-4 text-sm font-semibold text-foreground hover:bg-background disabled:opacity-40"
      >
        {st.save}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={onRemove}
        aria-label={`${st.remove} — ${rate.name}`}
        className="ml-auto grid h-11 w-11 place-items-center rounded-md border border-border text-danger hover:bg-background disabled:opacity-40"
      >
        <Trash size={16} />
      </button>
    </li>
  )
}
