'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import {
  updateLoyaltySettingsAction,
  type UpdateLoyaltySettingsState,
} from './actions'

export type LoyaltySettingsView = {
  loyalty_enabled: boolean
  loyalty_earn_rate_retail: number
  loyalty_earn_rate_loan_interest: number
  loyalty_redemption_rate: number
  loyalty_referral_bonus: number
}

const INITIAL_STATE: UpdateLoyaltySettingsState = {}

export default function LoyaltySettingsContent({
  initial,
}: {
  initial: LoyaltySettingsView
}) {
  const [state, formAction, pending] = useActionState<UpdateLoyaltySettingsState, FormData>(
    updateLoyaltySettingsAction,
    INITIAL_STATE,
  )
  const [enabled, setEnabled] = useState(initial.loyalty_enabled)
  const { t } = useI18n()
  const ls = t.loyalty.settings

  const inputClass =
    'w-32 rounded-md border border-border bg-card px-3 py-2 text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-gold/50 disabled:cursor-not-allowed disabled:opacity-60'

  return (
    <div className="px-4 py-8">
      <Link
        href="/settings"
        className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft size={14} weight="bold" />
        {t.common.backToSettings}
      </Link>
      <h1 className="mb-2 text-2xl font-semibold text-foreground">{t.settingsHub.loyalty.title}</h1>
      <p className="mb-6 text-sm text-muted">{ls.subtitle}</p>

      <form action={formAction} className="space-y-6">
        <fieldset className="rounded-lg border border-border p-4">
          <legend className="px-2 text-sm font-medium text-foreground">{ls.enableLegend}</legend>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              name="loyalty_enabled"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-border text-gold focus:ring-gold/50"
            />
            {ls.enableLabel}
          </label>
        </fieldset>

        <fieldset className="rounded-lg border border-border p-4 space-y-4">
          <legend className="px-2 text-sm font-medium text-foreground">{ls.earnLegend}</legend>
          <p className="text-xs text-muted">
            {enabled ? ls.earnHelp : ls.earnHelpDisabled}
          </p>
          <label className="flex items-center justify-between gap-4 text-sm text-foreground">
            <span>{ls.earnRetail}</span>
            <input
              type="number"
              name="loyalty_earn_rate_retail"
              defaultValue={initial.loyalty_earn_rate_retail}
              step="0.01"
              min="0"
              max="1000"
              disabled={!enabled}
              className={inputClass}
            />
          </label>
          <label className="flex items-center justify-between gap-4 text-sm text-foreground">
            <span>{ls.earnLoanInterest}</span>
            <input
              type="number"
              name="loyalty_earn_rate_loan_interest"
              defaultValue={initial.loyalty_earn_rate_loan_interest}
              step="0.01"
              min="0"
              max="1000"
              disabled={!enabled}
              className={inputClass}
            />
          </label>
        </fieldset>

        <fieldset className="rounded-lg border border-border p-4 space-y-4">
          <legend className="px-2 text-sm font-medium text-foreground">{ls.redemptionLegend}</legend>
          <label className="flex items-center justify-between gap-4 text-sm text-foreground">
            <span>{ls.redemptionRate}</span>
            <input
              type="number"
              name="loyalty_redemption_rate"
              defaultValue={initial.loyalty_redemption_rate}
              step="0.01"
              min="0.01"
              max="100000"
              disabled={!enabled}
              className={inputClass}
            />
          </label>
          <p className="text-xs text-muted">{ls.redemptionHelp}</p>
        </fieldset>

        <fieldset className="rounded-lg border border-border p-4 space-y-4">
          <legend className="px-2 text-sm font-medium text-foreground">{ls.referralLegend}</legend>
          <label className="flex items-center justify-between gap-4 text-sm text-foreground">
            <span>{ls.referralBonus}</span>
            <input
              type="number"
              name="loyalty_referral_bonus"
              defaultValue={initial.loyalty_referral_bonus}
              step="1"
              min="0"
              max="1000000"
              disabled={!enabled}
              className={inputClass}
            />
          </label>
        </fieldset>

        {state.error && (
          <p className="text-sm text-danger" role="alert">
            {ls.errors[state.error]}
          </p>
        )}
        {state.ok && (
          <p className="text-sm text-success" role="status">
            {ls.saved}
          </p>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-gold px-4 py-2 text-sm font-medium text-navy hover:bg-gold/90 focus:outline-none focus:ring-2 focus:ring-gold/50 disabled:opacity-50"
          >
            {pending ? t.common.saving : t.common.save}
          </button>
        </div>
      </form>
    </div>
  )
}
