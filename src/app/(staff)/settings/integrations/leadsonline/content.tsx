'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { CheckCircle, ShieldCheck, Warning, WarningCircle } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { EnvBadge } from '@/components/leadsonline/EnvBadge'
import {
  checkDoNotBuyAction,
  markNoTransactionDayAction,
  saveLeadsOnlineAction,
  testLeadsOnlineAction,
  type DoNotBuyState,
  type LeadsOnlineState,
} from './actions'

export type LeadsOnlineSubmissionView = {
  id: string
  /** When it was sent, already written in the shop's time. */
  at: string
  env: 'sandbox' | 'production'
  method: string
  ticketType: string
  ticketNumber: string
  isVoid: boolean
  images: number
  ok: boolean
  code: number | null
  response: string
}

export type LeadsOnlineSettingsView = {
  storeId: string
  username: string
  env: 'sandbox' | 'production'
  passwordSet: boolean
  recent: LeadsOnlineSubmissionView[]
  /** Days sent as "no transactions" (patches/0124), newest first. */
  noTransactionDays: Array<{
    id: string
    day: string
    env: 'sandbox' | 'production'
    ok: boolean
    byHand: boolean
    response: string
    /** When it was sent, shop time. */
    at: string
  }>
}

const INPUT =
  'block w-full rounded-xl border-2 border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-blue disabled:opacity-50'
const LABEL = 'block text-sm font-semibold text-foreground'
const HELP = 'block text-xs text-text-secondary'
const CARD = 'space-y-4 rounded-xl border border-border bg-card p-4'
const OUTLINE = 'rounded-xl border border-border bg-card px-4 py-2 text-sm font-bold text-foreground hover:bg-background disabled:opacity-50'

export default function LeadsOnlineSettingsContent({ view }: { view: LeadsOnlineSettingsView }) {
  const { t } = useI18n()
  const tl = t.leadsonline
  const [state, saveAction, saving] = useActionState<LeadsOnlineState, FormData>(saveLeadsOnlineAction, {})
  const [testState, testAction, testing] = useActionState<LeadsOnlineState, FormData>(testLeadsOnlineAction, {})
  const [dnb, dnbAction, checking] = useActionState<DoNotBuyState, FormData>(checkDoNotBuyAction, {})
  const [noTx, noTxAction, markingDay] = useActionState<LeadsOnlineState, FormData>(markNoTransactionDayAction, {})
  const [env, setEnv] = useState(view.env)
  const [clearPassword, setClearPassword] = useState(false)
  const configured = view.storeId !== '' && view.username !== '' && view.passwordSet

  const errText = (s: { error?: string; detail?: string }) => {
    if (!s.error || s.error === 'invalid') return null
    const base = (tl.errors as Record<string, string>)[s.error] ?? s.error
    return base.replace('{detail}', s.detail ?? '')
  }
  const fe = (k: string) => {
    const code = state.fieldErrors?.[k]
    return code ? ((tl.fieldErrors as Record<string, string>)[code] ?? t.common.error) : null
  }

  return (
    <div className="mx-auto w-full max-w-[760px] space-y-6">
      <header>
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <Link href="/settings" className="hover:text-foreground">
            {tl.crumbSettings}
          </Link>
          <span>/</span>
          <Link href="/settings/integrations" className="hover:text-foreground">
            {tl.crumbIntegrations}
          </Link>
          <span>/</span>
          <span className="text-foreground">{tl.title}</span>
        </div>
        <h1 className="font-display mt-1 flex items-center gap-2 text-2xl font-bold text-foreground">
          <ShieldCheck size={22} weight="bold" />
          {tl.title}
        </h1>
        <p className="text-sm text-text-secondary">{tl.intro}</p>
      </header>

      <form action={saveAction} className={CARD}>
        <div className="flex flex-wrap items-center gap-2">
          {configured ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-success">
              <CheckCircle size={11} weight="bold" />
              {tl.statusConnected}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-background px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-text-secondary">
              <WarningCircle size={11} weight="bold" />
              {tl.statusNotConnected}
            </span>
          )}
          <EnvBadge env={view.env} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="space-y-1">
            <span className={LABEL}>{tl.storeId}</span>
            <input name="store_id" inputMode="numeric" defaultValue={view.storeId} className={`${INPUT} font-mono`} />
            {fe('store_id') ? <span className="block text-xs text-danger">{fe('store_id')}</span> : <span className={HELP}>{tl.storeIdHelp}</span>}
          </label>
          <label className="space-y-1">
            <span className={LABEL}>{tl.username}</span>
            <input name="username" autoComplete="off" defaultValue={view.username} className={`${INPUT} font-mono`} />
            {fe('username') ? <span className="block text-xs text-danger">{fe('username')}</span> : <span className={HELP}>{tl.usernameHelp}</span>}
          </label>
        </div>

        <div className="space-y-1">
          <label className="block space-y-1">
            <span className={LABEL}>{tl.password}</span>
            <input
              name={clearPassword ? undefined : 'password'}
              type="password"
              autoComplete="new-password"
              placeholder={view.passwordSet ? '••••••••••••' : ''}
              disabled={clearPassword}
              className={`${INPUT} font-mono`}
            />
            <span className={HELP}>{view.passwordSet ? tl.passwordSetHelp : tl.passwordHelp}</span>
          </label>
          {view.passwordSet ? (
            <label className="flex items-center gap-2 text-xs text-foreground">
              <input type="checkbox" checked={clearPassword} onChange={(e) => setClearPassword(e.target.checked)} />
              {tl.passwordClear}
              {clearPassword ? <input type="hidden" name="password" value="__CLEAR__" /> : null}
            </label>
          ) : null}
        </div>

        <fieldset className="space-y-2">
          <legend className={LABEL}>{tl.env}</legend>
          <div className="flex flex-wrap gap-2">
            {(['sandbox', 'production'] as const).map((e) => (
              <label
                key={e}
                className={`inline-flex h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm font-semibold ${
                  env === e ? 'border-navy bg-navy text-white' : 'border-border bg-card text-foreground hover:border-blue'
                }`}
              >
                <input type="radio" name="env" value={e} checked={env === e} onChange={() => setEnv(e)} className="sr-only" />
                {e === 'sandbox' ? tl.envSandbox : tl.envProduction}
              </label>
            ))}
          </div>
          {env === 'production' ? (
            <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-foreground">
              <Warning size={14} weight="bold" className="mt-0.5 shrink-0 text-warning" />
              {tl.envProductionWarning}
            </p>
          ) : (
            <p className={HELP}>{tl.envSandboxHelp}</p>
          )}
        </fieldset>

        {errText(state) ? <p className="text-sm text-danger">{errText(state)}</p> : null}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-gold px-4 py-2.5 text-sm font-bold text-navy transition-all hover:-translate-y-0.5 hover:bg-gold-2 hover:shadow-lg disabled:opacity-50"
          >
            {saving ? t.common.saving : t.common.save}
          </button>
          {state.ok ? <span className="text-sm text-success">{tl.saved}</span> : null}
        </div>
      </form>

      <form action={testAction} className={`${CARD} flex flex-wrap items-center gap-3 space-y-0`}>
        <button type="submit" disabled={testing || !configured} className={OUTLINE}>
          {testing ? tl.testing : tl.test}
        </button>
        <span className="text-xs text-text-secondary">{tl.testHelp}</span>
        {testState.ok ? <span className="text-sm font-semibold text-success">{tl.testOk}</span> : null}
        {errText(testState) ? <span className="text-sm text-danger">{errText(testState)}</span> : null}
      </form>

      <form action={dnbAction} className={CARD}>
        <div>
          <h2 className="text-base font-bold text-foreground">{tl.dnbTitle}</h2>
          <p className={HELP}>{tl.dnbHelp}</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="space-y-1">
            <span className={LABEL}>{tl.dnbName}</span>
            <input name="name" autoComplete="off" className={INPUT} />
          </label>
          <label className="space-y-1">
            <span className={LABEL}>{tl.dnbId}</span>
            <input name="id" autoComplete="off" className={`${INPUT} font-mono`} />
          </label>
          <label className="space-y-1">
            <span className={LABEL}>{tl.dnbDob}</span>
            <input name="dob" type="date" className={INPUT} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={checking || !configured} className={OUTLINE}>
            {checking ? tl.dnbChecking : tl.dnbCheck}
          </button>
          {errText(dnb) ? <span className="text-sm text-danger">{errText(dnb)}</span> : null}
          {dnb.hits && dnb.hits.length === 0 ? (
            <span className="text-sm font-semibold text-success">{tl.dnbClear}</span>
          ) : null}
        </div>
        {dnb.hits && dnb.hits.length > 0 ? (
          <div role="alert" className="space-y-2 rounded-md border border-danger/40 bg-danger/5 p-3 text-sm">
            <p className="font-bold text-danger">{tl.dnbHits.replace('{n}', String(dnb.hits.length))}</p>
            <ul className="space-y-1">
              {dnb.hits.map((h, i) => (
                <li key={i} className="text-foreground">
                  <span className="font-semibold">{h.name}</span>
                  {h.dob ? ` · ${h.dob}` : ''}
                  {h.ID ? ` · ${h.state} ${h.ID}` : ''}
                  {h.agency ? ` · ${tl.dnbAgency} ${h.agency}` : ''}
                  {h.contactName || h.contactNumber ? ` · ${tl.dnbContact} ${[h.contactName, h.contactNumber].filter(Boolean).join(' ')}` : ''}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </form>

      <section className={CARD}>
        <div>
          <h2 className="text-base font-bold text-foreground">{tl.noTx.title}</h2>
          <p className={HELP}>{tl.noTx.help}</p>
        </div>
        <form action={noTxAction} className="flex flex-wrap items-end gap-3">
          <label className="space-y-1">
            <span className={LABEL}>{tl.noTx.day}</span>
            <input name="day" type="date" required className={INPUT} />
          </label>
          <button type="submit" disabled={markingDay || !configured} className={`${OUTLINE} h-[46px]`}>
            {markingDay ? tl.noTx.sending : tl.noTx.send}
          </button>
        </form>
        {noTx.ok ? (
          <p className="text-sm font-semibold text-success">{tl.noTx.sentOk.replace('{day}', noTx.detail ?? '')}</p>
        ) : null}
        {noTx.error ? (
          <p className="text-sm text-danger">
            {(tl.noTx.errors as Record<string, string>)[noTx.error] ?? errText(noTx)}
          </p>
        ) : null}
        {view.noTransactionDays.length === 0 ? (
          <p className="text-sm text-text-secondary">{tl.noTx.empty}</p>
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-text-secondary">
                <tr>
                  <th className="py-2 pr-3 font-semibold">{tl.noTx.colDay}</th>
                  <th className="py-2 pr-3 font-semibold">{tl.colWhere}</th>
                  <th className="py-2 pr-3 font-semibold">{tl.noTx.colHow}</th>
                  <th className="py-2 font-semibold">{tl.colResult}</th>
                </tr>
              </thead>
              <tbody>
                {view.noTransactionDays.map((d) => (
                  <tr key={d.id} className="border-t border-border align-top">
                    <td className="py-2 pr-3 font-mono">{d.day}</td>
                    <td className="py-2 pr-3">
                      <EnvBadge env={d.env} />
                    </td>
                    <td className="py-2 pr-3 text-text-secondary">
                      {d.byHand ? tl.noTx.byHand : tl.noTx.nightly} · <span className="font-mono text-xs">{d.at}</span>
                    </td>
                    <td className="py-2">
                      {d.ok ? (
                        <span className="font-semibold text-success">{tl.resultOk}</span>
                      ) : (
                        <span className="text-danger">{d.response || tl.resultNoAnswer}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={CARD}>
        <div>
          <h2 className="text-base font-bold text-foreground">{tl.recentTitle}</h2>
          <p className={HELP}>{tl.recentHelp}</p>
        </div>
        {view.recent.length === 0 ? (
          <p className="text-sm text-text-secondary">{tl.recentEmpty}</p>
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-text-secondary">
                <tr>
                  <th className="py-2 pr-3 font-semibold">{tl.colWhen}</th>
                  <th className="py-2 pr-3 font-semibold">{tl.colTicket}</th>
                  <th className="py-2 pr-3 font-semibold">{tl.colWhere}</th>
                  <th className="py-2 pr-3 text-right font-semibold">{tl.colImages}</th>
                  <th className="py-2 font-semibold">{tl.colResult}</th>
                </tr>
              </thead>
              <tbody>
                {view.recent.map((r) => (
                  <tr key={r.id} className="border-t border-border align-top">
                    <td className="py-2 pr-3 font-mono text-xs">{r.at}</td>
                    <td className="py-2 pr-3 font-mono">
                      {r.ticketType === 'Buy' || r.ticketType === 'Pawn' ? tl.ticketTypes[r.ticketType] : r.ticketType} {r.ticketNumber}
                      {r.isVoid ? <span className="ml-1 rounded bg-danger/10 px-1 text-[11px] font-bold text-danger">{tl.voidTag}</span> : null}
                    </td>
                    <td className="py-2 pr-3">
                      <EnvBadge env={r.env} />
                    </td>
                    <td className="py-2 pr-3 text-right font-mono">{r.images}</td>
                    <td className="py-2">
                      {r.ok ? (
                        <span className="font-semibold text-success">{tl.resultOk}</span>
                      ) : (
                        <span className="text-danger">
                          {r.code != null ? `${r.code}: ` : ''}
                          {r.response || tl.resultNoAnswer}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

