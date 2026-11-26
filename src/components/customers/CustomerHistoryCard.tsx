'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { ArrowSquareOut, ListBullets } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { Modal, Footer } from '@/components/pawn/RecordPaymentDialog'

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
 * picked customer (CustomerPicker `afterSelected`), as tall as the name box.
 * "Show" opens the records in a popup, like "Pawned before" (Eddy,
 * 2026-11-26). Read-only.
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
  text: { loading: string; failed: string; none: string; show: string }
  stats?: HistoryStat[]
  /** "Since 4/28/2026", already worded. */
  since?: string | null
  rows?: HistoryRow[]
  allHref?: string
  allLabel?: string
}) {
  const { t } = useI18n()
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
              aria-haspopup="dialog"
              onClick={() => setOpen(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-semibold text-foreground hover:bg-background"
            >
              <ListBullets size={14} weight="bold" />
              {text.show}
            </button>
          ) : null}
        </div>
      </div>

      {open
        ? createPortal(
            <Modal title={title} onClose={() => setOpen(false)}>
              <ul className="max-h-[55vh] divide-y divide-border overflow-y-auto rounded-xl border border-border">
                {rows.map((r) => (
                  <li key={r.id}>
                    {/* A new tab: the ticket being written stays as it is. */}
                    <Link
                      href={r.href}
                      target="_blank"
                      className="flex items-center gap-3 px-3 py-2.5 hover:bg-background"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-semibold text-foreground">{r.number}</span>
                          <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${r.badge.className}`}>
                            {r.badge.text}
                          </span>
                        </div>
                        <div className="mt-0.5 text-xs text-muted">
                          {r.date}
                          {r.detail ? ` · ${r.detail}` : ''}
                        </div>
                      </div>
                      <span className="shrink-0 font-mono text-sm font-bold text-foreground">{r.amount}</span>
                      <ArrowSquareOut size={14} weight="bold" className="shrink-0 text-muted" />
                    </Link>
                  </li>
                ))}
              </ul>
              <Footer>
                {allHref && allLabel ? (
                  <Link
                    href={allHref}
                    target="_blank"
                    className="mr-auto text-sm font-semibold text-blue hover:underline"
                  >
                    {allLabel}
                  </Link>
                ) : null}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md bg-navy px-4 py-2 text-sm font-medium text-white hover:bg-navy/90"
                >
                  {t.common.close}
                </button>
              </Footer>
            </Modal>,
            document.body,
          )
        : null}
    </div>
  )
}
