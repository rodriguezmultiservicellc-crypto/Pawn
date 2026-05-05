'use client'

import { useActionState, useState } from 'react'
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
  const [state, formAction] = useActionState<UpdateLoyaltySettingsState, FormData>(
    updateLoyaltySettingsAction,
    INITIAL_STATE,
  )
  const [enabled, setEnabled] = useState(initial.loyalty_enabled)

  const inputClass =
    'w-32 rounded-md border border-hairline bg-canvas px-3 py-2 text-ink shadow-sm focus:outline-none focus:ring-2 focus:ring-rausch/50 disabled:cursor-not-allowed disabled:opacity-60'

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-2 text-2xl font-semibold text-ink">Loyalty &amp; Referrals</h1>
      <p className="mb-6 text-sm text-ash">
        Configure point earn / redemption rates and referral bonuses for this shop.
        When disabled, no new earn / redeem / referral events fire — existing balances persist.
      </p>

      <form action={formAction} className="space-y-6">
        <fieldset className="rounded-lg border border-hairline p-4">
          <legend className="px-2 text-sm font-medium text-ink">Enable</legend>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              name="loyalty_enabled"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-hairline text-rausch focus:ring-rausch/50"
            />
            Enable loyalty for this shop
          </label>
        </fieldset>

        <fieldset className="rounded-lg border border-hairline p-4 space-y-4">
          <legend className="px-2 text-sm font-medium text-ink">Earn rates</legend>
          <p className="text-xs text-ash">
            {enabled
              ? 'Points awarded per dollar of activity.'
              : 'Enable loyalty above to configure rates.'}
          </p>
          <label className="flex items-center justify-between gap-4 text-sm text-ink">
            <span>Retail sales — points per $1 of subtotal</span>
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
          <label className="flex items-center justify-between gap-4 text-sm text-ink">
            <span>Loan interest paid — points per $1</span>
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

        <fieldset className="rounded-lg border border-hairline p-4 space-y-4">
          <legend className="px-2 text-sm font-medium text-ink">Redemption</legend>
          <label className="flex items-center justify-between gap-4 text-sm text-ink">
            <span>Points required per $1 of discount</span>
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
          <p className="text-xs text-ash">
            Default 100 = 1 point is worth $0.01.
          </p>
        </fieldset>

        <fieldset className="rounded-lg border border-hairline p-4 space-y-4">
          <legend className="px-2 text-sm font-medium text-ink">Referral bonus</legend>
          <label className="flex items-center justify-between gap-4 text-sm text-ink">
            <span>Points awarded to referrer on first qualifying transaction</span>
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
          <p className="text-sm text-error" role="alert">
            {state.error}
          </p>
        )}
        {state.ok && (
          <p className="text-sm text-success" role="status">
            Saved.
          </p>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            className="rounded-md bg-rausch px-4 py-2 text-sm font-medium text-canvas hover:bg-rausch/90 focus:outline-none focus:ring-2 focus:ring-rausch/50"
          >
            Save
          </button>
        </div>
      </form>
    </div>
  )
}
