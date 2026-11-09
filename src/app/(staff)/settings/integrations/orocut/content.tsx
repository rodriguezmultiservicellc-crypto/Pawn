'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { CheckCircle, Lightning, WarningCircle } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import {
  testOrocutTokenAction,
  updateOrocutSettingsAction,
  type OrocutSettingsState,
} from './actions'

export type OrocutSettingsView = {
  tokenConfigured: boolean
  webhookSecretConfigured: boolean
  styleNames: string[]
  /** null when NEXT_PUBLIC_APP_URL is not https (local dev) → polling only. */
  webhookUrl: string | null
  apiBase: string
  openOrders: number
}

const initial: OrocutSettingsState = {}

export default function OrocutSettingsContent({ view }: { view: OrocutSettingsView }) {
  const { t } = useI18n()
  const to = t.orocut
  const [state, formAction, pending] = useActionState(updateOrocutSettingsAction, initial)
  const [testState, testAction, testing] = useActionState(testOrocutTokenAction, initial)

  const fe = (k: string) => {
    const code = state.fieldErrors?.[k]
    return code ? ((to.fieldErrors as Record<string, string>)[code] ?? code) : null
  }
  const errText = (s: OrocutSettingsState) => {
    if (!s.error || s.error === 'invalid') return null
    const base = (to.errors as Record<string, string>)[s.error] ?? s.error
    return s.detail ? base.replace('{detail}', s.detail) : base
  }

  return (
    <div className="mx-auto w-full max-w-[640px] space-y-6">
      <header>
        <div className="flex items-center gap-2 text-sm text-muted">
          <Link href="/settings" className="hover:text-foreground">
            {to.crumbSettings}
          </Link>
          <span>/</span>
          <Link href="/settings/integrations" className="hover:text-foreground">
            {to.crumbIntegrations}
          </Link>
          <span>/</span>
          <span className="text-foreground">{to.title}</span>
        </div>
        <h1 className="font-display mt-1 flex items-center gap-2 text-2xl font-bold text-foreground">
          <Lightning size={22} weight="bold" />
          {to.title}
        </h1>
        <p className="text-sm text-muted">{to.intro}</p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        {view.tokenConfigured ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-success">
            <CheckCircle size={10} weight="bold" />
            {to.statusConnected}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-background px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">
            <WarningCircle size={10} weight="bold" />
            {to.statusNotConnected}
          </span>
        )}
        <span className="text-xs text-muted">
          {to.openOrders.replace('{n}', String(view.openOrders))}
        </span>
      </div>

      <form action={formAction} className="space-y-5 rounded-xl border border-border bg-card p-4">
        <SecretField
          name="orocut_order_token"
          label={to.token}
          help={view.tokenConfigured ? to.tokenSetHelp : to.tokenHelp}
          clearLabel={to.tokenClear}
          isSet={view.tokenConfigured}
          placeholder="ord_…"
          error={fe('orocut_order_token')}
        />

        <SecretField
          name="orocut_webhook_secret"
          label={to.webhookSecret}
          help={view.webhookSecretConfigured ? to.webhookSecretSetHelp : to.webhookSecretHelp}
          clearLabel={to.webhookSecretClear}
          isSet={view.webhookSecretConfigured}
          placeholder="whsec_…"
          error={fe('orocut_webhook_secret')}
        />

        <label className="block space-y-1">
          <span className="block text-xs font-semibold text-foreground">{to.styles}</span>
          <textarea
            name="orocut_style_names"
            rows={6}
            defaultValue={view.styleNames.join('\n')}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-sm text-foreground"
            placeholder={'Np-2 With Y\nNp-1 Script'}
          />
          {fe('orocut_style_names') ? (
            <span className="block text-xs text-danger">{fe('orocut_style_names')}</span>
          ) : (
            <span className="block text-[11px] text-muted">{to.stylesHelp}</span>
          )}
        </label>

        <div className="space-y-1">
          <span className="block text-xs font-semibold text-foreground">{to.webhook}</span>
          {view.webhookUrl ? (
            <input
              readOnly
              value={view.webhookUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground"
              aria-label={to.webhook}
            />
          ) : (
            <p className="text-xs text-warning">{to.webhookLocal}</p>
          )}
          <span className="block text-[11px] text-muted">{to.webhookHelp}</span>
        </div>

        {errText(state) ? <p className="text-sm text-danger">{errText(state)}</p> : null}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md border border-gold bg-gold px-3 py-1.5 text-xs font-bold text-navy hover:bg-gold-2 disabled:opacity-50"
          >
            {pending ? to.saving : to.save}
          </button>
          {state.ok ? <span className="text-sm text-success">{to.saved}</span> : null}
        </div>
      </form>

      <form action={testAction} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
        <button
          type="submit"
          disabled={testing || !view.tokenConfigured}
          className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-background disabled:opacity-50"
        >
          {testing ? to.testing : to.test}
        </button>
        <span className="font-mono text-[11px] text-muted">{view.apiBase}</span>
        {testState.ok ? <span className="text-sm text-success">{to.testOk}</span> : null}
        {errText(testState) ? <span className="text-sm text-danger">{errText(testState)}</span> : null}
      </form>
    </div>
  )
}

/** Write-only secret: never re-rendered; blank = keep, checkbox = clear. */
function SecretField({
  name,
  label,
  help,
  clearLabel,
  isSet,
  placeholder,
  error,
}: {
  name: string
  label: string
  help: string
  clearLabel: string
  isSet: boolean
  placeholder: string
  error: string | null
}) {
  const [clear, setClear] = useState(false)
  return (
    <div className="space-y-1">
      <label className="block space-y-1">
        <span className="block text-xs font-semibold text-foreground">{label}</span>
        <input
          name={clear ? undefined : name}
          type="password"
          autoComplete="off"
          placeholder={isSet ? '••••••••••••' : placeholder}
          disabled={clear}
          className="w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-sm text-foreground disabled:opacity-50"
        />
        {error ? (
          <span className="block text-xs text-danger">{error}</span>
        ) : (
          <span className="block text-[11px] text-muted">{help}</span>
        )}
      </label>
      {isSet ? (
        <label className="flex items-center gap-2 text-xs text-foreground">
          <input type="checkbox" checked={clear} onChange={(e) => setClear(e.target.checked)} />
          {clearLabel}
          {clear ? <input type="hidden" name={name} value="__CLEAR__" /> : null}
        </label>
      ) : null}
    </div>
  )
}
