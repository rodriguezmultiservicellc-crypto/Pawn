'use client'

import { useState, useTransition } from 'react'
import { HandCoins } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { saveReaderTipsAction } from './actions'

export type ReaderTipsView = {
  enabled: boolean
  /** Whole percents, in the order the reader shows them. */
  percentages: number[]
}

/**
 * Settings → Card reader → Tips (patches/0096): ask for a tip on the reader,
 * and which percentages it offers. Turning it on talks to Stripe first; the
 * switch is only saved if the reader could be set up.
 */
export function TipsCard({
  tips,
  canEdit,
  hasReader,
}: {
  tips: ReaderTipsView
  canEdit: boolean
  hasReader: boolean
}) {
  const { t } = useI18n()
  const c = t.cardReader
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [enabled, setEnabled] = useState(tips.enabled)
  const [choices, setChoices] = useState<string[]>(() => [0, 1, 2].map((i) => (tips.percentages[i] != null ? String(tips.percentages[i]) : '')))
  const disabled = !canEdit || pending

  const save = (e: React.FormEvent) => {
    e.preventDefault()
    setMsg(null)
    start(async () => {
      const r = await saveReaderTipsAction({ enabled, percentages: choices.map((v) => v.trim()).filter(Boolean) })
      setMsg(r.ok ? { ok: true, text: c.saved } : { ok: false, text: c.errors[r.error].replace('{detail}', r.detail ?? '') })
    })
  }

  return (
    <form onSubmit={save} className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <HandCoins size={20} className="text-gold" />
        <h2 className="text-base font-semibold text-foreground">{c.tips.title}</h2>
      </div>
      <p className="text-sm text-muted">{c.tips.help}</p>

      <label className="flex items-start gap-3 text-sm text-foreground">
        <input
          type="checkbox"
          checked={enabled}
          disabled={disabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-border"
        />
        <span className="font-semibold">{c.tips.enable}</span>
      </label>

      <fieldset className="space-y-1">
        <legend className="text-sm font-semibold text-foreground">{c.tips.choices}</legend>
        <div className="flex flex-wrap gap-2">
          {choices.map((v, i) => (
            <span key={i} className="inline-flex items-center gap-1 text-sm text-muted">
              <input
                type="number"
                inputMode="numeric"
                step="1"
                min="1"
                max="100"
                value={v}
                disabled={disabled}
                aria-label={`${c.tips.choices} ${i + 1}`}
                onChange={(e) => setChoices((cur) => cur.map((x, j) => (j === i ? e.target.value : x)))}
                className="h-11 w-24 rounded-xl border-2 border-border bg-background px-3 text-right font-mono text-sm text-foreground outline-none transition-colors focus:border-blue disabled:opacity-60"
              />
              %
            </span>
          ))}
        </div>
        <p className="text-xs text-muted">{c.tips.choicesHelp}</p>
      </fieldset>

      {!hasReader ? <p className="text-sm text-warning">{c.tips.needReader}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={disabled || (enabled && !hasReader)}
          className="inline-flex h-11 items-center gap-2 rounded-xl bg-gold px-5 text-sm font-bold text-navy transition-all hover:-translate-y-0.5 hover:bg-gold-2 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-45"
        >
          {pending ? t.common.saving : c.tips.save}
        </button>
        {msg ? (
          <span role={msg.ok ? 'status' : 'alert'} className={`text-sm ${msg.ok ? 'text-success' : 'text-danger'}`}>
            {msg.text}
          </span>
        ) : null}
      </div>
    </form>
  )
}
