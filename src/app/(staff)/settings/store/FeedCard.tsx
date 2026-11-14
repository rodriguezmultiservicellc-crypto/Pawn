'use client'

import { useState } from 'react'
import { Copy, Check } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'

export type FeedState = {
  /** Absolute feed address (custom domain when verified). Null when the catalog is not published. */
  url: string | null
  /** The saved flag — the address answers only once this is saved on. */
  published: boolean
  total: number
  inFeed: number
}

/** Product feed section of Settings → Online store (patches/0080). */
export function FeedCard({
  state,
  enabled,
  canEdit,
  onToggle,
}: {
  state: FeedState
  enabled: boolean
  canEdit: boolean
  onToggle: (v: boolean) => void
}) {
  const { t } = useI18n()
  const f = t.storeSettings.feed
  const [copied, setCopied] = useState(false)
  const noPhoto = state.total - state.inFeed

  const copy = async () => {
    if (!state.url) return
    try {
      await navigator.clipboard.writeText(state.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked: the address is selectable text */
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div>
        <h2 className="text-sm font-semibold text-foreground">{f.title}</h2>
        <p className="mt-1 text-xs text-muted">{f.help}</p>
      </div>
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          disabled={!canEdit || !state.url}
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
          className="mt-1"
        />
        <span className="font-semibold text-foreground">{f.enable}</span>
      </label>

      {state.url && enabled ? (
        state.published ? (
          <div className="space-y-3">
            <div className="space-y-1 text-sm">
              <span className="font-semibold text-foreground">{f.url}</span>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-xl border border-border bg-background px-3 py-2 font-mono text-xs text-foreground">
                  {state.url}
                </code>
                <button
                  type="button"
                  onClick={copy}
                  className="inline-flex items-center gap-1 rounded-xl border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-background"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? f.copied : f.copy}
                </button>
              </div>
            </div>
            <p className="text-xs text-muted">
              {f.counts.replace('{inFeed}', String(state.inFeed)).replace('{total}', String(state.total))}
            </p>
            {noPhoto > 0 ? (
              <p className="text-xs text-warning">{f.noPhoto.replace('{count}', String(noPhoto))}</p>
            ) : null}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-border p-3 text-xs">
                <p className="font-semibold text-foreground">{f.googleTitle}</p>
                <p className="mt-1 text-muted">{f.googleSteps}</p>
              </div>
              <div className="rounded-xl border border-border p-3 text-xs">
                <p className="font-semibold text-foreground">{f.metaTitle}</p>
                <p className="mt-1 text-muted">{f.metaSteps}</p>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted">{f.saveFirst}</p>
        )
      ) : null}
    </section>
  )
}
