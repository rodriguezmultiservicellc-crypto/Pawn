'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, CheckCircle, Scales, Warning } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { maxMonthlyRate, type Jurisdiction } from '@/lib/jurisdictions/rules'
import { SHOP_TIMEZONES } from '@/lib/jurisdictions/timezones'
import {
  saveComplianceSettingsAction,
  type SaveComplianceState,
} from './actions'

type Current = {
  jurisdictionCode: string | null
  timezone: string
  gracePeriodDays: number | null
  buyHoldPeriodDays: number
  abandonedRepairDays: number
}

type Effective = {
  graceDays: number
  buyHoldDays: number
  repairAbandonDays: number
  retentionYears: number | null
}

const inputCls =
  'block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue disabled:opacity-60'

export default function ComplianceSettingsContent({
  canEdit,
  jurisdictions,
  current,
  effective,
}: {
  canEdit: boolean
  jurisdictions: Jurisdiction[]
  current: Current
  effective: Effective
}) {
  const { t } = useI18n()
  const tj = t.jurisdiction.settings
  const [state, formAction, pending] = useActionState<SaveComplianceState, FormData>(
    saveComplianceSettingsAction,
    {},
  )
  const [code, setCode] = useState<string>(current.jurisdictionCode ?? '')
  const selected = jurisdictions.find((j) => j.code === code) ?? null

  const fieldError = (k: string): string | null => {
    const raw = state.fieldErrors?.[k]
    if (!raw) return null
    const m = /^below_statute:(\d+)$/.exec(raw)
    return m ? tj.belowStatute.replace('{days}', m[1]) : t.common.error
  }

  const days = (n: number | null | undefined) =>
    n == null ? '—' : tj.daysValue.replace('{n}', String(n))

  return (
    <div className="space-y-6">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft size={14} weight="bold" />
        {t.common.back}
      </Link>

      <header>
        <h1 className="font-display text-2xl font-bold text-foreground">{tj.title}</h1>
        <p className="mt-1 text-sm text-muted">{tj.subtitle}</p>
      </header>

      {!current.jurisdictionCode ? (
        <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-foreground">
          <Warning size={16} weight="bold" className="mt-0.5 shrink-0 text-warning" />
          <span>{tj.noJurisdiction}</span>
        </div>
      ) : null}

      <form action={formAction} className="space-y-4 rounded-xl border border-border bg-card p-4">
        {state.error ? (
          <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
            {state.error}
          </div>
        ) : null}
        {state.ok ? (
          <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm text-success">
            <CheckCircle size={14} weight="bold" />
            {t.common.save} ✓
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-sm font-semibold text-foreground">{tj.jurisdiction}</span>
            <select
              name="jurisdiction_code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={!canEdit}
              className={inputCls}
            >
              <option value="">{tj.jurisdictionNone}</option>
              {jurisdictions.map((j) => (
                <option key={j.code} value={j.code}>
                  {j.name} ({j.code})
                </option>
              ))}
            </select>
            <span className="block text-xs text-muted">{tj.jurisdictionHelp}</span>
          </label>

          <label className="block space-y-1">
            <span className="text-sm font-semibold text-foreground">{tj.timezone}</span>
            <select
              name="timezone"
              defaultValue={current.timezone}
              disabled={!canEdit}
              className={inputCls}
            >
              {SHOP_TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
            <span className="block text-xs text-muted">{tj.timezoneHelp}</span>
          </label>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <DaysField
            name="grace_period_days"
            label={tj.graceDays}
            defaultValue={current.gracePeriodDays}
            statutory={selected?.grace_days ?? null}
            placeholder={selected ? String(selected.grace_days) : ''}
            error={fieldError('grace_period_days')}
            disabled={!canEdit}
          />
          <DaysField
            name="buy_hold_period_days"
            label={tj.buyHoldDays}
            defaultValue={current.buyHoldPeriodDays}
            statutory={selected?.buy_hold_days ?? null}
            error={fieldError('buy_hold_period_days')}
            disabled={!canEdit}
            required
          />
          <DaysField
            name="abandoned_repair_days"
            label={tj.repairAbandonDays}
            defaultValue={current.abandonedRepairDays}
            statutory={selected?.repair_abandon_days ?? null}
            error={fieldError('abandoned_repair_days')}
            disabled={!canEdit}
            required
          />
        </div>

        <p className="text-xs text-muted">
          {tj.effectiveNow
            .replace('{grace}', days(effective.graceDays))
            .replace('{hold}', days(effective.buyHoldDays))
            .replace('{abandon}', days(effective.repairAbandonDays))}
        </p>

        {canEdit ? (
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={pending}
              className="rounded-xl bg-gold px-4 py-2.5 text-sm font-bold text-navy transition-all hover:-translate-y-0.5 hover:bg-gold-2 hover:shadow-lg disabled:opacity-50"
            >
              {pending ? t.common.saving : t.common.save}
            </button>
          </div>
        ) : (
          <p className="text-xs text-muted">{tj.ownerOnly}</p>
        )}
      </form>

      {selected ? (
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-blue/10 text-blue">
              <Scales size={18} weight="bold" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                {tj.statutoryTitle.replace('{name}', selected.name)}
              </h2>
              <p className="text-xs text-muted">{selected.statute ?? '—'}</p>
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <Stat
              label={tj.rateCap}
              value={(() => {
                const cap = maxMonthlyRate(selected, null)
                if (cap == null) return '—'
                const base = `${(cap * 100).toFixed(2)}% / ${days(selected.period_days)}`
                return selected.rate_tiers ? `${base} ${tj.tieredSuffix}` : base
              })()}
            />
            <Stat
              label={tj.minChargeCap}
              value={
                selected.min_charge_cap == null
                  ? '—'
                  : `$${selected.min_charge_cap.toFixed(2)}`
              }
            />
            <Stat
              label={tj.term}
              value={
                selected.min_term_days == null && selected.max_term_days == null
                  ? '—'
                  : selected.min_term_days === selected.max_term_days
                  ? days(selected.min_term_days)
                  : `${selected.min_term_days ?? '—'}–${selected.max_term_days ?? '—'}`
              }
            />
            <Stat label={tj.statutoryGrace} value={days(selected.grace_days)} />
            <Stat label={tj.statutoryHold} value={days(selected.buy_hold_days)} />
            <Stat
              label={tj.statutoryAbandon}
              value={
                selected.repair_abandon_days == null
                  ? tj.notGoverned
                  : days(selected.repair_abandon_days)
              }
            />
            <Stat
              label={tj.retention}
              value={
                selected.record_retention_years == null
                  ? '—'
                  : tj.yearsValue.replace('{n}', String(selected.record_retention_years))
              }
            />
            <Stat
              label={tj.policeReporting}
              value={selected.police_reporting_required ? tj.required : tj.notRequired}
            />
          </dl>
          <p className="mt-4 text-xs text-muted">
            {selected.verified_on
              ? tj.verifiedOn.replace('{date}', selected.verified_on)
              : tj.unverified}
          </p>
        </section>
      ) : null}
    </div>
  )
}

function DaysField({
  name,
  label,
  defaultValue,
  statutory,
  placeholder,
  error,
  disabled,
  required,
}: {
  name: string
  label: string
  defaultValue: number | null
  statutory: number | null
  placeholder?: string
  error: string | null
  disabled: boolean
  required?: boolean
}) {
  const { t } = useI18n()
  return (
    <label className="block space-y-1">
      <span className="text-sm font-semibold text-foreground">{label}</span>
      <input
        type="number"
        name={name}
        min={statutory ?? 0}
        step={1}
        required={required}
        defaultValue={defaultValue ?? ''}
        placeholder={placeholder}
        disabled={disabled}
        className={`${inputCls} ${error ? 'border-danger/60' : ''}`}
      />
      <span className="block text-xs text-muted">
        {statutory == null
          ? t.jurisdiction.settings.noStatutoryMin
          : t.jurisdiction.settings.statutoryMin.replace('{n}', String(statutory))}
      </span>
      {error ? <span className="block text-xs text-danger">{error}</span> : null}
    </label>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 font-mono text-sm text-foreground">{value}</dd>
    </div>
  )
}
