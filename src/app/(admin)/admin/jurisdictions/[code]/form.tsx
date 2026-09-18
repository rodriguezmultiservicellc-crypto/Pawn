'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { ArrowLeft, CheckCircle } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { SHOP_TIMEZONES } from '@/lib/jurisdictions/timezones'
import { saveJurisdictionAction, type SaveJurisdictionState } from '../actions'

export type JurisdictionFormInitial = {
  code: string
  country: 'US' | 'CA'
  region: string
  name: string
  statute: string
  default_timezone: string
  rate_cap_percent: string
  period_days: string
  min_charge_cap: string
  min_term_days: string
  max_term_days: string
  grace_days: string
  grace_rolls_to_business_day: boolean
  buy_hold_days: string
  repair_abandon_days: string
  record_retention_years: string
  police_reporting_required: boolean
  rate_tiers_json: string
  ticket_notices_json: string
  ticket_backpage: string
  notes: string
  verified_on: string
  verified_source: string
  is_active: boolean
}

const inputCls =
  'block w-full rounded-xl border-2 border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-blue'

export default function JurisdictionForm({
  initial,
}: {
  initial: JurisdictionFormInitial | null
}) {
  const { t } = useI18n()
  const ta = t.jurisdiction.admin
  const [state, formAction, pending] = useActionState<SaveJurisdictionState, FormData>(
    saveJurisdictionAction,
    {},
  )
  const i = initial
  const err = (k: string) => {
    const raw = state.fieldErrors?.[k]
    if (!raw) return null
    const map: Record<string, string> = {
      invalid_tiers: ta.errTiers,
      invalid_notices: ta.errNotices,
      code_immutable: ta.errCodeImmutable,
      term_range: ta.errTermRange,
    }
    return map[raw] ?? t.common.error
  }

  const text = (
    name: keyof JurisdictionFormInitial,
    label: string,
    opts: { type?: string; step?: string; help?: string; readOnly?: boolean } = {},
  ) => (
    <label className="block space-y-1">
      <span className="text-sm font-semibold text-foreground">{label}</span>
      <input
        name={name}
        type={opts.type ?? 'text'}
        step={opts.step}
        readOnly={opts.readOnly}
        defaultValue={i ? String(i[name] ?? '') : ''}
        className={`${inputCls} ${opts.readOnly ? 'opacity-60' : ''}`}
      />
      {opts.help ? <span className="block text-xs text-muted">{opts.help}</span> : null}
      {err(name) ? <span className="block text-xs text-danger">{err(name)}</span> : null}
    </label>
  )

  const check = (name: keyof JurisdictionFormInitial, label: string, def: boolean) => (
    <label className="flex items-center gap-2 text-sm text-foreground">
      <input
        type="checkbox"
        name={name}
        defaultChecked={i ? Boolean(i[name]) : def}
        className="h-4 w-4 accent-[var(--color-blue)]"
      />
      {label}
    </label>
  )

  return (
    <div className="space-y-6">
      <Link
        href="/admin/jurisdictions"
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft size={14} weight="bold" />
        {ta.title}
      </Link>
      <h1 className="font-display text-2xl font-bold text-foreground">
        {i ? `${i.name} (${i.code})` : ta.add}
      </h1>

      <form action={formAction} className="space-y-6">
        {i ? <input type="hidden" name="existing_code" value={i.code} /> : null}

        {state.error ? (
          <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
            {state.error === 'duplicate_code' ? ta.errDuplicate : state.error}
          </div>
        ) : null}
        {state.ok ? (
          <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm text-success">
            <CheckCircle size={14} weight="bold" />
            {t.common.save} ✓
          </div>
        ) : null}

        <section className="grid grid-cols-1 gap-4 rounded-xl border border-border bg-card p-4 md:grid-cols-4">
          <label className="block space-y-1">
            <span className="text-sm font-semibold text-foreground">{ta.country}</span>
            <select
              name="country"
              defaultValue={i?.country ?? 'US'}
              disabled={!!i}
              className={inputCls}
            >
              <option value="US">US</option>
              <option value="CA">CA</option>
            </select>
            {i ? <input type="hidden" name="country" value={i.country} /> : null}
          </label>
          {text('region', ta.region, { readOnly: !!i, help: ta.regionHelp })}
          {text('name', ta.name)}
          <label className="block space-y-1">
            <span className="text-sm font-semibold text-foreground">{ta.timezone}</span>
            <select
              name="default_timezone"
              defaultValue={i?.default_timezone ?? 'America/New_York'}
              className={inputCls}
            >
              {SHOP_TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </label>
          <div className="md:col-span-4">{text('statute', ta.statute)}</div>
        </section>

        <section className="space-y-4 rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">{ta.sectionLoan}</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            {text('rate_cap_percent', ta.rateCapPercent, { type: 'number', step: '0.0001', help: ta.rateCapHelp })}
            {text('period_days', ta.periodDays, { type: 'number' })}
            {text('min_charge_cap', ta.minChargeCap, { type: 'number', step: '0.01', help: ta.minChargeCapHelp })}
            {text('grace_days', ta.graceDays, { type: 'number' })}
            {text('min_term_days', ta.minTermDays, { type: 'number' })}
            {text('max_term_days', ta.maxTermDays, { type: 'number' })}
          </div>
          {check('grace_rolls_to_business_day', ta.graceRolls, false)}
          <label className="block space-y-1">
            <span className="text-sm font-semibold text-foreground">{ta.rateTiers}</span>
            <textarea
              name="rate_tiers_json"
              rows={4}
              spellCheck={false}
              defaultValue={i?.rate_tiers_json ?? ''}
              placeholder='[{"up_to": 80, "rate": 0.025}, {"up_to": null, "rate": 0.015}]'
              className={`${inputCls} font-mono text-xs`}
            />
            <span className="block text-xs text-muted">{ta.rateTiersHelp}</span>
            {err('rate_tiers_json') ? (
              <span className="block text-xs text-danger">{err('rate_tiers_json')}</span>
            ) : null}
          </label>
        </section>

        <section className="space-y-4 rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">{ta.sectionOther}</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {text('buy_hold_days', ta.buyHoldDays, { type: 'number' })}
            {text('repair_abandon_days', ta.repairAbandonDays, { type: 'number', help: ta.optionalHelp })}
            {text('record_retention_years', ta.retentionYears, { type: 'number' })}
          </div>
          {check('police_reporting_required', ta.policeReporting, false)}
        </section>

        <section className="space-y-4 rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">{ta.sectionTicket}</h2>
          <label className="block space-y-1">
            <span className="text-sm font-semibold text-foreground">{ta.notices}</span>
            <textarea
              name="ticket_notices_json"
              rows={10}
              spellCheck={false}
              defaultValue={i?.ticket_notices_json ?? '[]'}
              className={`${inputCls} font-mono text-xs`}
            />
            <span className="block text-xs text-muted">{ta.noticesHelp}</span>
            {err('ticket_notices_json') ? (
              <span className="block text-xs text-danger">{err('ticket_notices_json')}</span>
            ) : null}
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-semibold text-foreground">{ta.backpage}</span>
            <textarea
              name="ticket_backpage"
              rows={12}
              spellCheck={false}
              defaultValue={i?.ticket_backpage ?? ''}
              className={`${inputCls} font-mono text-xs`}
            />
          </label>
        </section>

        <section className="space-y-4 rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">{ta.sectionVerification}</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {text('verified_on', ta.verifiedOn, { type: 'date' })}
            <div className="md:col-span-2">{text('verified_source', ta.verifiedSource)}</div>
          </div>
          <label className="block space-y-1">
            <span className="text-sm font-semibold text-foreground">{ta.notes}</span>
            <textarea
              name="notes"
              rows={3}
              defaultValue={i?.notes ?? ''}
              className={inputCls}
            />
          </label>
          {check('is_active', ta.active, true)}
        </section>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={pending}
            className="rounded-xl bg-gold px-4 py-2.5 text-sm font-bold text-navy transition-all hover:-translate-y-0.5 hover:bg-gold-2 hover:shadow-lg disabled:opacity-50"
          >
            {pending ? t.common.saving : t.common.save}
          </button>
        </div>
      </form>
    </div>
  )
}
