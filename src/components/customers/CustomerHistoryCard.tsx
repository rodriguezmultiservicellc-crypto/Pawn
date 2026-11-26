'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CaretDown } from '@phosphor-icons/react'

export type HistoryStat = { label: string; value: string; tone?: string }

export type HistoryRow = {
  id: string
  href: string
  number: string
  /** Already formatted. */
  date: string
  badge: { text: string; className: string }
  amount: string
  detail: string
}

/**
 * The picked customer's history on a New ticket / New sale — the one card
 * behind Pawn history, Repair history and Purchases: a row of counts, and on
 * demand the recent records with a link to all of them. Sits beside the
 * picked customer (CustomerPicker `afterSelected`), as tall as the name box
 * until "Show" opens it. Read-only.
 */
export function CustomerHistoryCard({
  state,
  icon,
  title,
  text,
  stats = [],
  since = null,
  rows = [],
  allHref,
  allLabel,
}: {
  state: 'loading' | 'failed' | 'empty' | 'ready'
  icon: React.ReactNode
  title: string
  text: { loading: string; failed: string; none: string; show: string; hide: string }
  stats?: HistoryStat[]
  /** "Since 4/28/2026", already worded. */
  since?: string | null
  rows?: HistoryRow[]
  allHref?: string
  allLabel?: string
}) {
  const [open, setOpen] = useState(false)

  const shell =
    'flex min-h-[52px] min-w-[min(100%,20rem)] flex-1 flex-col justify-center rounded-md border border-border bg-card px-3 py-1.5'
  if (state === 'failed') return <div className={`${shell} text-sm text-danger`}>{text.failed}</div>
  if (state === 'loading') return <div className={`${shell} text-sm text-muted`}>{text.loading}</div>
  if (state === 'empty') return <div className={`${shell} text-sm text-muted`}>{text.none}</div>

  return (
    <div className={shell}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          {icon}
          {title}
        </div>
        {stats.map((s) => (
          <div key={s.label}>
            <div className="text-[11px] uppercase leading-tight tracking-wide text-muted">{s.label}</div>
            <div className={`font-mono text-base font-bold leading-tight ${s.tone ?? 'text-foreground'}`}>
              {s.value}
            </div>
          </div>
        ))}
        <div className="ml-auto flex items-center gap-3">
          {since ? <span className="text-xs text-muted">{since}</span> : null}
          {rows.length > 0 ? (
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className="inline-flex h-9 items-center gap-1 rounded-md border border-border bg-card px-3 text-xs font-semibold text-foreground hover:bg-background"
            >
              {open ? text.hide : text.show}
              <CaretDown size={12} weight="bold" className={`transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
          ) : null}
        </div>
      </div>

      {open ? (
        <div className="mb-1.5 mt-2 border-t border-border pt-3">
          <ul className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                <Link href={r.href} target="_blank" className="font-mono font-semibold text-blue hover:underline">
                  {r.number}
                </Link>
                <span className="font-mono text-xs text-muted">{r.date}</span>
                <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${r.badge.className}`}>
                  {r.badge.text}
                </span>
                <span className="font-mono text-xs text-foreground">{r.amount}</span>
                <span className="min-w-0 flex-1 text-xs text-text-secondary">{r.detail || '—'}</span>
              </li>
            ))}
          </ul>
          {allHref && allLabel ? (
            <Link
              href={allHref}
              target="_blank"
              className="mt-3 inline-block text-xs font-semibold text-blue hover:underline"
            >
              {allLabel}
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
