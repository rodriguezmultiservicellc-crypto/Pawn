'use client'

import { useState, useTransition } from 'react'
import { CheckCircle, Globe } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { verificationRecordName } from '@/lib/store/custom-domain'
import { removeCustomDomainAction, setCustomDomainAction, verifyCustomDomainAction } from './actions'

export type DomainState = { domain: string | null; token: string | null; verified: boolean }

export function DomainCard({ state, canEdit }: { state: DomainState; canEdit: boolean }) {
  const { t } = useI18n()
  const d = t.storeSettings.domain
  const [input, setInput] = useState(state.domain ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: keyof typeof d.errors }>) => {
    setError(null)
    start(async () => {
      const r = await fn()
      if (!r.ok) setError(d.errors[r.error])
    })
  }

  const btn = 'rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground hover:border-blue hover:text-blue disabled:opacity-50'

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Globe size={16} /> {d.title}
      </h2>
      <p className="text-xs text-muted">{d.help}</p>

      {state.domain && state.verified ? (
        <p className="flex items-center gap-2 text-sm text-success">
          <CheckCircle size={16} weight="fill" /> {d.verified.replace('{domain}', state.domain)}
        </p>
      ) : null}

      {state.domain && !state.verified && state.token ? (
        <div className="space-y-1 rounded-xl border border-warning/30 bg-warning/5 p-3 text-sm text-foreground">
          <p>{d.pending}</p>
          <p className="break-all font-mono text-xs">
            {d.txt.replace('{name}', verificationRecordName(state.domain)).replace('{value}', state.token)}
          </p>
          <p className="break-all font-mono text-xs">{d.cname.replace('{domain}', state.domain)}</p>
          <p className="text-xs text-muted">{d.rmsNote}</p>
        </div>
      ) : null}

      {canEdit ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-64 flex-1 space-y-1 text-sm">
            <span className="font-semibold text-foreground">{d.label}</span>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={d.placeholder}
              className="w-full rounded-xl border border-border bg-card px-3 py-2 font-mono text-sm text-foreground focus:border-blue focus:outline-none"
            />
          </label>
          <button type="button" disabled={pending} className={btn} onClick={() => run(() => setCustomDomainAction(input))}>
            {d.set}
          </button>
          {state.domain && !state.verified ? (
            <button type="button" disabled={pending} className={btn} onClick={() => run(verifyCustomDomainAction)}>
              {d.verify}
            </button>
          ) : null}
          {state.domain ? (
            <button type="button" disabled={pending} className={`${btn} hover:border-danger hover:text-danger`} onClick={() => run(removeCustomDomainAction)}>
              {d.remove}
            </button>
          ) : null}
        </div>
      ) : null}
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </section>
  )
}
