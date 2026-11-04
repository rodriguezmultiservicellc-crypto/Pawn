'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import type { CustomQuoteSettings } from '@/lib/custom-quotes/settings'
import {
  updateCustomQuoteSettingsAction,
  type UpdateCustomQuoteSettingsState,
} from './actions'

export default function CustomQuoteSettingsContent({
  initial,
}: {
  initial: CustomQuoteSettings
}) {
  const { t } = useI18n()
  const ts = t.settingsCustomQuotes
  const [state, action, pending] = useActionState<UpdateCustomQuoteSettingsState, FormData>(
    updateCustomQuoteSettingsAction,
    {},
  )
  const fe = (k: string) => state.fieldErrors?.[k]
  const errText = (code: string | undefined) =>
    code == null ? null : (ts.errors as Record<string, string>)[code] ?? code

  return (
    <div className="space-y-6">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft size={14} weight="bold" />
        {t.nav.settings}
      </Link>

      <div>
        <h1 className="font-display text-2xl font-bold">{ts.title}</h1>
        <p className="mt-1 text-sm text-muted">{ts.subtitle}</p>
      </div>

      <form action={action} className="space-y-4">
        <fieldset className="grid grid-cols-1 gap-4 rounded-xl border border-border bg-card p-4 sm:grid-cols-2">
          <NumberField
            name="default_margin"
            label={ts.defaultMargin}
            help={ts.defaultMarginHelp}
            defaultValue={Math.round(initial.defaultMarginPct * 100)}
            min={0}
            max={95}
            error={errText(fe('default_margin'))}
          />
          <NumberField
            name="min_margin"
            label={ts.minMargin}
            help={ts.minMarginHelp}
            defaultValue={Math.round(initial.minMarginPct * 100)}
            min={0}
            max={95}
            error={errText(fe('min_margin'))}
          />
          <NumberField
            name="default_deposit"
            label={ts.defaultDeposit}
            defaultValue={Math.round(initial.defaultDepositPct * 100)}
            min={0}
            max={100}
            error={errText(fe('default_deposit'))}
          />
          <NumberField
            name="expiry_days"
            label={ts.expiryDays}
            defaultValue={initial.expiryDays}
            min={1}
            max={365}
            error={errText(fe('expiry_days'))}
          />
          <NumberField
            name="labor_rate"
            label={ts.laborRate}
            defaultValue={initial.laborRate}
            min={0}
            step={0.01}
            error={errText(fe('labor_rate'))}
          />
        </fieldset>

        <fieldset className="rounded-xl border border-border bg-card p-4">
          <label className="flex items-start gap-3 text-sm text-foreground">
            <input
              type="checkbox"
              name="show_cost_breakdown"
              defaultChecked={initial.showCostBreakdown}
              className="mt-0.5 h-4 w-4 rounded border-border accent-gold"
            />
            <span>
              <span className="font-medium">{ts.showBreakdown}</span>
              <span className="mt-1 block text-xs text-muted">{ts.showBreakdownHelp}</span>
            </span>
          </label>
        </fieldset>

        <div className="flex items-center justify-end gap-3">
          {state.ok ? <span className="text-sm text-success">{ts.saved}</span> : null}
          {state.error && !state.ok ? (
            <span className="text-sm text-danger" role="alert">
              {errText(state.error)}
            </span>
          ) : null}
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-gold px-4 py-2 text-sm font-medium text-navy hover:bg-gold-2 disabled:opacity-50"
          >
            {pending ? ts.saving : ts.save}
          </button>
        </div>
      </form>
    </div>
  )
}

function NumberField({
  name,
  label,
  help,
  defaultValue,
  min,
  max,
  step,
  error,
}: {
  name: string
  label: string
  help?: string
  defaultValue: number
  min?: number
  max?: number
  step?: number
  error: string | null
}) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <input
        type="number"
        name={name}
        defaultValue={defaultValue}
        min={min}
        max={max}
        step={step ?? 1}
        className={`block w-40 rounded-md border bg-card px-3 py-2 font-mono text-foreground focus:border-blue focus:outline-none ${
          error ? 'border-danger' : 'border-border'
        }`}
      />
      {help ? <span className="block text-xs text-muted">{help}</span> : null}
      {error ? (
        <span className="block text-xs text-danger" role="alert">
          {error}
        </span>
      ) : null}
    </label>
  )
}
