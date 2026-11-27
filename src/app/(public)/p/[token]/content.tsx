'use client'

import { useEffect, useRef } from 'react'
import { ArrowUpRight, Phone, Storefront } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { formatMoney } from '@/lib/format/money'
import { formatCalendarDate } from '@/lib/format/date'
import type { PublicPawn } from '@/lib/pawn/public-ticket'
import LanguageToggle from '@/app/(public)/s/[slug]/LanguageToggle'

/**
 * Customer-facing pawn ticket page body. Mobile-first: it opens from a text.
 * Shows exactly what lib/pawn/public-ticket.ts hands it.
 */
export default function PawnTicketContent({ doc }: { doc: PublicPawn }) {
  const { t, lang, setLang } = useI18n()
  const tp = t.pawnPublic

  // Open in the customer's own language once; the toggle rules after that.
  const applied = useRef(false)
  useEffect(() => {
    if (applied.current) return
    applied.current = true
    if (doc.language !== lang) setLang(doc.language)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const date = (iso: string) =>
    formatCalendarDate(iso, lang, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
  const open = doc.status === 'open'
  const pastDue = open && doc.daysToDue < 0
  const pastLastDay = open && doc.today > doc.lastDay

  return (
    <>
      <header className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            {doc.shop.logoUrl ? (
              // Operator-supplied URL, possibly off-platform; 36×36.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={doc.shop.logoUrl} alt="" className="h-9 w-9 rounded-md object-cover" />
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-gold text-navy">
                <Storefront size={18} weight="bold" />
              </div>
            )}
            <span className="truncate text-base font-semibold text-foreground">{doc.shop.name}</span>
          </div>
          <LanguageToggle />
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 sm:py-10">
        <div className="mb-4">
          <div className="text-xs uppercase tracking-wide text-text-secondary">{tp.title}</div>
          <h1 className="font-display text-2xl font-bold text-foreground sm:text-3xl">
            {tp.ticket} <span className="font-mono">{doc.ticketNumber}</span>
          </h1>
          <p className="mt-1 text-sm text-text-secondary">{tp.pawnedOn.replace('{date}', date(doc.issueDate))}</p>
        </div>

        {doc.status === 'redeemed' ? (
          <Banner tone="success">{tp.redeemedBanner}</Banner>
        ) : doc.status === 'forfeited' ? (
          <Banner tone="muted">{tp.forfeitedBanner}</Banner>
        ) : pastLastDay ? (
          <Banner tone="danger">{tp.pastLastDayBanner}</Banner>
        ) : pastDue ? (
          <Banner tone="warning">{tp.pastDueBanner.replace('{date}', date(doc.lastDay))}</Banner>
        ) : null}

        {open ? (
          <section className="mt-4 rounded-xl border border-border bg-card p-4">
            <div className="text-xs uppercase tracking-wide text-text-secondary">{tp.payoffToday}</div>
            <div className="mt-1 font-mono text-3xl font-bold tabular-nums text-foreground">
              {doc.payoff == null ? '—' : formatMoney(doc.payoff)}
            </div>
            <p className="mt-1 text-xs text-text-secondary">{tp.payoffNote}</p>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs uppercase tracking-wide text-text-secondary">{tp.dueDate}</dt>
                <dd className="font-mono text-foreground">{date(doc.dueDate)}</dd>
                <dd className={`text-xs font-semibold ${pastDue ? 'text-warning' : 'text-text-secondary'}`}>
                  {doc.daysToDue > 1
                    ? tp.daysLeft.replace('{n}', String(doc.daysToDue))
                    : doc.daysToDue === 1
                      ? tp.dueTomorrow
                      : doc.daysToDue === 0
                        ? tp.dueToday
                        : tp.daysPast.replace('{n}', String(-doc.daysToDue))}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-text-secondary">{tp.lastDay}</dt>
                <dd className="font-mono text-foreground">{date(doc.lastDay)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-text-secondary">{tp.loanAmount}</dt>
                <dd className="font-mono text-foreground">{formatMoney(doc.principal)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-text-secondary">{tp.chargeSoFar}</dt>
                <dd className="font-mono text-foreground">{doc.chargeSoFar == null ? '—' : formatMoney(doc.chargeSoFar)}</dd>
              </div>
            </dl>
          </section>
        ) : null}

        {doc.items.length > 0 ? (
          <section className="mt-4 rounded-xl border border-border bg-card p-4">
            <h2 className="text-xs uppercase tracking-wide text-text-secondary">{tp.items}</h2>
            <ul className="mt-2 space-y-3">
              {doc.items.map((it, i) => (
                <li key={i} className="flex items-start gap-3">
                  {it.photoUrl ? (
                    // Signed URL (1h) from a private bucket.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.photoUrl} alt="" className="h-16 w-16 shrink-0 rounded-lg border border-border object-cover" />
                  ) : null}
                  <p className="min-w-0 text-sm text-foreground">{it.description}</p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {doc.history.length > 0 ? (
          <section className="mt-4 rounded-xl border border-border bg-card p-4">
            <h2 className="text-xs uppercase tracking-wide text-text-secondary">{tp.history}</h2>
            <ul className="mt-2 divide-y divide-border text-sm">
              {doc.history.map((h, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3 py-2">
                  <span className="text-foreground">
                    {tp.kinds[h.kind]}
                    <span className="ml-2 font-mono text-xs text-text-secondary">{date(h.date)}</span>
                  </span>
                  <span className="font-mono tabular-nums text-foreground">{h.amount == null ? '' : formatMoney(h.amount)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="mt-4 rounded-xl border border-border bg-card p-4">
          <p className="text-sm text-foreground">{open ? tp.bringTicket : tp.questions}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {doc.shop.phone ? (
              <a
                href={`tel:${doc.shop.phone.replace(/[^\d+]/g, '')}`}
                className="inline-flex items-center gap-2 rounded-xl bg-gold px-4 py-2 text-sm font-bold text-navy hover:bg-gold-2"
              >
                <Phone size={16} weight="bold" />
                {tp.call} · <span className="font-mono">{doc.shop.phone}</span>
              </a>
            ) : null}
            {doc.shop.publicSlug ? (
              <a
                href={`/s/${doc.shop.publicSlug}`}
                className="inline-flex items-center gap-1 rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-background"
              >
                {tp.visitSite}
                <ArrowUpRight size={14} weight="bold" />
              </a>
            ) : null}
          </div>
        </section>

        <p className="mt-6 text-center text-[11px] text-text-secondary">{tp.privacyNote}</p>
      </main>
    </>
  )
}

function Banner({ tone, children }: { tone: 'success' | 'muted' | 'warning' | 'danger'; children: React.ReactNode }) {
  const cls = {
    success: 'border-success/40 bg-success/10 font-semibold text-foreground',
    muted: 'border-border bg-background text-text-secondary',
    warning: 'border-warning/40 bg-warning/10 font-semibold text-foreground',
    danger: 'border-danger/40 bg-danger/10 font-semibold text-foreground',
  }[tone]
  return (
    <div role="status" className={`rounded-xl border px-4 py-3 text-sm ${cls}`}>
      {children}
    </div>
  )
}
