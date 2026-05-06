'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import {
  ArrowsClockwise,
  CheckCircle,
  Plug,
  PlugsConnected,
  Warning,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import {
  disconnectEbayAction,
  runSyncNowAction,
  updateEbayConfigAction,
} from './actions'
import type { EbayEnvironment } from '@/types/database-aliases'

export type EbayCredentialsView = {
  connected: boolean
  ebay_user_id: string | null
  environment: EbayEnvironment
  site_id: string
  merchant_location_key: string | null
  fulfillment_policy_id: string | null
  payment_policy_id: string | null
  return_policy_id: string | null
  access_token_expires_at: string | null
  refresh_token_expires_at: string | null
  connected_at: string | null
  disconnected_at: string | null
}

export default function EbaySettingsContent({
  view,
  success,
  errorParam,
}: {
  view: EbayCredentialsView
  success: boolean
  errorParam: string | null
}) {
  const { t } = useI18n()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<
    { kind: 'ok' | 'error'; text: string } | null
  >(null)

  function onDisconnect() {
    if (!confirm(t.ebay.confirmDisconnect)) return
    setMessage(null)
    startTransition(async () => {
      const res = await disconnectEbayAction()
      if (res.ok) {
        setMessage({ kind: 'ok', text: t.ebay.disconnectedToast })
      } else {
        setMessage({ kind: 'error', text: res.error })
      }
    })
  }

  function onSync() {
    setMessage(null)
    startTransition(async () => {
      const res = await runSyncNowAction()
      if (res.ok) {
        setMessage({
          kind: 'ok',
          text: t.ebay.syncRanToast
            .replace('{synced}', String(res.synced))
            .replace('{failed}', String(res.failed)),
        })
      } else {
        setMessage({ kind: 'error', text: res.error })
      }
    })
  }

  function onSubmitConfig(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setMessage(null)
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const res = await updateEbayConfigAction(fd)
      if (res.ok) {
        setMessage({ kind: 'ok', text: t.common.save + ' ✓' })
      } else {
        setMessage({ kind: 'error', text: res.error })
      }
    })
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">{t.ebay.settingsTitle}</h1>
        <p className="text-sm text-muted">{t.ebay.settingsSubtitle}</p>
      </div>

      <div className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
        {t.ebay.scaffoldNotice}
      </div>

      {success ? (
        <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm text-success">
          <CheckCircle size={16} weight="fill" />
          {t.ebay.connectedToast}
        </div>
      ) : null}
      {errorParam ? (
        <div className="flex items-center gap-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          <Warning size={16} weight="fill" />
          {t.ebay.errorPrefix}: {errorParam}
        </div>
      ) : null}
      {message ? (
        <div
          className={`rounded-md border px-3 py-2 text-sm ${
            message.kind === 'ok'
              ? 'border-success/30 bg-success/5 text-success'
              : 'border-danger/30 bg-danger/5 text-danger'
          }`}
        >
          {message.text}
        </div>
      ) : null}

      {/* Connection card */}
      <fieldset className="rounded-lg border border-border bg-card p-4">
        <legend className="px-1 text-sm font-semibold text-foreground">
          {t.ebay.connectionTitle}
        </legend>

        {view.connected ? (
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2 text-success">
              <PlugsConnected size={16} weight="fill" />
              <span>{t.ebay.connected}</span>
            </div>
            <div className="grid grid-cols-1 gap-2 text-muted sm:grid-cols-2">
              <Field
                label={t.ebay.ebayUserId}
                value={view.ebay_user_id ?? '—'}
              />
              <Field label={t.ebay.environment} value={view.environment} />
              <Field
                label={t.ebay.accessTokenExpires}
                value={fmtTs(view.access_token_expires_at)}
              />
              <Field
                label={t.ebay.refreshTokenExpires}
                value={fmtTs(view.refresh_token_expires_at)}
              />
              <Field
                label={t.ebay.connectedAt}
                value={fmtTs(view.connected_at)}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <button
                type="button"
                disabled={pending}
                onClick={onSync}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground hover:border-foreground disabled:opacity-50"
              >
                <ArrowsClockwise size={14} weight="bold" />
                {t.ebay.runSyncNow}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={onDisconnect}
                className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
              >
                {t.ebay.disconnect}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted">{t.ebay.notConnectedHelp}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/api/ebay/oauth/start?env=sandbox"
                className="inline-flex items-center gap-1 rounded-md bg-gold px-4 py-2 text-navy font-medium hover:bg-gold-2"
              >
                <Plug size={14} weight="bold" />
                {t.ebay.connectSandbox}
              </Link>
              <Link
                href="/api/ebay/oauth/start?env=production"
                className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-4 py-2 text-foreground hover:border-foreground"
              >
                <Plug size={14} weight="bold" />
                {t.ebay.connectProduction}
              </Link>
            </div>
          </div>
        )}
      </fieldset>

      {/* Config card — only when connected. */}
      {view.connected ? (
        <fieldset className="rounded-lg border border-border bg-card p-4">
          <legend className="px-1 text-sm font-semibold text-foreground">
            {t.ebay.configTitle}
          </legend>
          <p className="text-xs text-muted">{t.ebay.configHelp}</p>

          <form onSubmit={onSubmitConfig} className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <ConfigField
              label={t.ebay.siteId}
              name="site_id"
              defaultValue={view.site_id}
              help={t.ebay.siteIdHelp}
            />
            <ConfigField
              label={t.ebay.merchantLocationKey}
              name="merchant_location_key"
              defaultValue={view.merchant_location_key ?? ''}
              help={t.ebay.merchantLocationKeyHelp}
            />
            <ConfigField
              label={t.ebay.fulfillmentPolicyId}
              name="fulfillment_policy_id"
              defaultValue={view.fulfillment_policy_id ?? ''}
            />
            <ConfigField
              label={t.ebay.paymentPolicyId}
              name="payment_policy_id"
              defaultValue={view.payment_policy_id ?? ''}
            />
            <ConfigField
              label={t.ebay.returnPolicyId}
              name="return_policy_id"
              defaultValue={view.return_policy_id ?? ''}
            />
            <div className="md:col-span-2 flex justify-end">
              <button
                type="submit"
                disabled={pending}
                className="rounded-md bg-gold px-4 py-2 text-navy font-medium hover:bg-gold-2 disabled:opacity-50"
              >
                {pending ? t.common.saving : t.common.save}
              </button>
            </div>
          </form>
        </fieldset>
      ) : null}

      <div>
        <Link
          href="/inventory/listings/ebay"
          className="text-sm font-medium text-gold hover:underline"
        >
          {t.ebay.openListingsLink} →
        </Link>
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className="truncate text-foreground">{value}</div>
    </div>
  )
}

function ConfigField({
  label,
  name,
  defaultValue,
  help,
}: {
  label: string
  name: string
  defaultValue?: string
  help?: string
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium uppercase tracking-wide text-muted">
        {label}
      </span>
      <input
        type="text"
        name={name}
        defaultValue={defaultValue}
        className="mt-1 block w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
      />
      {help ? (
        <span className="mt-0.5 block text-[11px] text-muted">{help}</span>
      ) : null}
    </label>
  )
}

function fmtTs(ts: string | null): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString()
}
