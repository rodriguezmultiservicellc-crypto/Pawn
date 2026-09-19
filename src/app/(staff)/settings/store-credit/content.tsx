'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import {
  updateStoreCreditSettingsAction,
  type UpdateStoreCreditSettingsState,
} from './actions'

export type StoreCreditSettingsView = {
  store_credit_enabled: boolean
  store_credit_expiry_days: number | null
}

const INITIAL: UpdateStoreCreditSettingsState = {}

export default function StoreCreditSettingsContent({
  initial,
}: {
  initial: StoreCreditSettingsView
}) {
  const { t } = useI18n()
  const ts = t.storeCredit.settings
  const [state, action, pending] = useActionState<
    UpdateStoreCreditSettingsState,
    FormData
  >(updateStoreCreditSettingsAction, INITIAL)
  const [enabled, setEnabled] = useState(initial.store_credit_enabled)

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
        <fieldset className="rounded-xl border border-border bg-card p-4">
          <label className="flex items-start gap-3 text-sm text-foreground">
            <input
              type="checkbox"
              name="store_credit_enabled"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-border text-gold focus:ring-gold/50"
            />
            <span>
              <span className="font-medium">{ts.toggle}</span>
              <span className="mt-1 block text-xs text-muted">
                {ts.toggleHelp}
              </span>
            </span>
          </label>
        </fieldset>

        <fieldset className="rounded-xl border border-border bg-card p-4">
          <label className="block space-y-1">
            <span className="text-sm font-medium text-foreground">
              {ts.expiryDays}
            </span>
            <input
              type="number"
              name="store_credit_expiry_days"
              min="1"
              max="3650"
              step="1"
              defaultValue={initial.store_credit_expiry_days ?? ''}
              disabled={!enabled}
              className="block w-40 rounded-md border border-border bg-card px-3 py-2 text-foreground focus:border-blue focus:outline-none disabled:opacity-60"
            />
            <span className="block text-xs text-muted">
              {ts.expiryDaysHelp}
            </span>
          </label>
        </fieldset>

        <div className="flex items-center justify-end gap-3">
          {state.ok ? (
            <span className="text-sm text-success">{ts.saved}</span>
          ) : null}
          {state.error ? (
            <span className="text-sm text-danger" role="alert">
              {t.common.fixErrorsBelow}
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
