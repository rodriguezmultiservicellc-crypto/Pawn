'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { ArrowLeft, CreditCard, Trash, WarningCircle } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { pairReaderAction, removeReaderAction, type ReaderActionResult } from './actions'

export type CardReaderView = {
  canEdit: boolean
  /** STRIPE_SECRET_KEY is set on the platform. */
  stripeConfigured: boolean
  /** The shop finished Stripe Connect onboarding. */
  connected: boolean
  testMode: boolean
  reader: { id: string; label: string | null } | null
  live: { status: 'online' | 'offline' | null; deviceType: string | null; serial: string | null } | null
}

const INPUT =
  'block h-11 w-full rounded-xl border-2 border-border bg-background px-4 text-sm text-foreground outline-none transition-colors focus:border-blue focus-visible:outline-3 focus-visible:outline-blue'
const GOLD =
  'inline-flex h-11 items-center gap-2 rounded-xl bg-gold px-5 text-sm font-bold text-navy transition-all hover:-translate-y-0.5 hover:bg-gold-2 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-45'

export default function CardReaderContent({ view }: { view: CardReaderView }) {
  const { t } = useI18n()
  const c = t.cardReader
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [code, setCode] = useState('')
  const [label, setLabel] = useState('')

  const canPair = view.canEdit && view.stripeConfigured && view.connected

  const show = (r: ReaderActionResult) => {
    if (r.ok) {
      setMsg({ ok: true, text: c.saved })
      setCode('')
      setLabel('')
    } else {
      setMsg({ ok: false, text: c.errors[r.error].replace('{detail}', r.detail ?? '') })
    }
  }

  const status = view.live?.status
  const statusText = status === 'online' ? c.statusOnline : status === 'offline' ? c.statusOffline : c.statusUnknown
  const statusCls = status === 'online' ? 'text-success' : status === 'offline' ? 'text-danger' : 'text-muted'

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <CreditCard size={28} className="text-gold" />
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">{c.title}</h1>
          <p className="text-sm text-muted">{c.subtitle}</p>
        </div>
        <Link href="/settings" className="ml-auto inline-flex items-center gap-1 text-sm text-blue hover:text-blue-2">
          <ArrowLeft size={14} /> {t.nav.settings}
        </Link>
      </div>

      {!view.stripeConfigured ? (
        <Notice text={c.stripeMissing} />
      ) : !view.connected ? (
        <Notice
          text={c.notConnected}
          link={
            <Link href="/settings/integrations" className="font-semibold text-blue hover:text-blue-2">
              {c.connectLink}
            </Link>
          }
        />
      ) : null}

      {view.reader ? (
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{c.paired}</h2>
          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
            <div className="text-lg font-semibold text-foreground">{view.reader.label ?? view.reader.id}</div>
            <div className={`text-sm font-semibold ${statusCls}`}>{statusText}</div>
            {view.live?.deviceType ? (
              <div className="text-sm text-muted">
                {c.device}: <span className="font-mono text-foreground">{view.live.deviceType}</span>
              </div>
            ) : null}
            <div className="text-sm text-muted">
              {c.readerId}: <span className="font-mono text-foreground">{view.reader.id}</span>
            </div>
            {view.canEdit ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (!confirm(c.removeConfirm.replace('{label}', view.reader?.label ?? view.reader?.id ?? ''))) return
                  setMsg(null)
                  start(async () => show(await removeReaderAction()))
                }}
                className="ml-auto inline-flex h-11 items-center gap-2 rounded-md border border-border px-4 text-sm font-semibold text-danger hover:bg-background disabled:opacity-45"
              >
                <Trash size={16} /> {c.remove}
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {view.canEdit ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!canPair) return
            setMsg(null)
            start(async () => show(await pairReaderAction({ registration_code: code, label })))
          }}
          className="space-y-4 rounded-xl border border-border bg-card p-5"
        >
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            {view.reader ? c.replaceTitle : c.pairTitle}
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="block text-sm font-semibold text-foreground">{c.code}</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="off"
                disabled={!canPair}
                className={`${INPUT} font-mono`}
              />
              <span className="block text-xs text-muted">{c.codeHelp}</span>
              {view.testMode ? <span className="block text-xs text-info">{c.testHint}</span> : null}
            </label>
            <label className="block space-y-1">
              <span className="block text-sm font-semibold text-foreground">{c.label}</span>
              <input
                value={label}
                maxLength={60}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={c.labelPlaceholder}
                disabled={!canPair}
                className={INPUT}
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={!canPair || pending || !code.trim() || !label.trim()} className={GOLD}>
              <CreditCard size={16} weight="bold" />
              {pending ? c.pairing : c.pair}
            </button>
            {msg ? (
              <span role="status" className={`text-sm ${msg.ok ? 'text-success' : 'text-danger'}`}>
                {msg.text}
              </span>
            ) : null}
          </div>
        </form>
      ) : null}
    </div>
  )
}

function Notice({ text, link }: { text: string; link?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-2 rounded-xl border border-warning/40 bg-warning/5 px-4 py-3 text-sm text-foreground">
      <WarningCircle size={18} className="mt-0.5 shrink-0 text-warning" />
      <span className="flex-1">{text}</span>
      {link}
    </div>
  )
}
