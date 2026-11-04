'use client'

import { useEffect, useRef } from 'react'
import { CheckCircle, Phone, Storefront, ArrowUpRight } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { formatMoney } from '@/lib/format/money'
import { formatCalendarDate } from '@/lib/format/date'
import {
  progressPercent,
  stageIndex,
  stageName,
} from '@/lib/repair/stages'
import type { PublicTicket } from '@/lib/repair/public-ticket'
import { serviceTypeLabel } from '@/components/repair/ServiceTypeBadge'
import LanguageToggle from '@/app/(public)/s/[slug]/LanguageToggle'

/**
 * Customer-facing tracking page body. Mobile-first — this opens from a
 * text message. Shows exactly what the public document carries and
 * nothing else; see lib/repair/public-ticket.ts for the allowlist.
 */
export default function TrackingContent({
  doc,
  photoUrl,
}: {
  doc: PublicTicket
  photoUrl: string | null
}) {
  const { t, lang, setLang } = useI18n()
  const tr = t.tracking

  // Open in the customer's own language (their record, not the browser's
  // Accept-Language). Once only — the toggle stays in charge afterwards.
  const applied = useRef(false)
  useEffect(() => {
    if (applied.current) return
    applied.current = true
    if (doc.language !== lang) setLang(doc.language)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pct = progressPercent(doc.stage)
  const currentIdx = stageIndex(doc.stages, doc.stage?.id)
  const isReady = doc.status === 'ready'
  const isPickedUp = doc.status === 'picked_up'
  const isClosed = doc.status === 'abandoned'
  const serviceLabel = serviceTypeLabel(t, doc.service_type)

  return (
    <>
      <header className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            {doc.shop.logo_url ? (
              // Operator-supplied URL, possibly off-platform; 36×36.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={doc.shop.logo_url} alt="" className="h-9 w-9 rounded-md object-cover" />
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-gold text-navy">
                <Storefront size={18} weight="bold" />
              </div>
            )}
            <span className="truncate text-base font-semibold text-foreground">
              {doc.shop.name}
            </span>
          </div>
          <LanguageToggle />
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 sm:py-10">
        <div className="mb-4">
          <div className="text-xs uppercase tracking-wide text-muted">{tr.title}</div>
          <h1 className="font-display text-2xl font-bold text-foreground sm:text-3xl">
            {tr.ticket} <span className="font-mono">{doc.ticket_number}</span>
          </h1>
          <p className="mt-1 text-sm text-muted">{serviceLabel}</p>
        </div>

        {isReady ? (
          <Banner tone="success">{tr.readyBanner}</Banner>
        ) : isPickedUp ? (
          <Banner tone="success">{tr.pickedUpBanner}</Banner>
        ) : isClosed ? (
          <Banner tone="muted">{tr.closedBanner}</Banner>
        ) : null}

        {/* Progress */}
        <section className="mt-4 rounded-xl border border-border bg-card p-4">
          <div className="flex items-baseline justify-between gap-2">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted">{tr.stage}</div>
              <div className="text-lg font-semibold text-foreground">
                {doc.stage ? stageName(doc.stage, lang) : tr.stageNone}
              </div>
            </div>
            <div className="font-mono text-sm text-muted">{pct}%</div>
          </div>
          <div
            className="mt-3 h-3 w-full overflow-hidden rounded-full bg-background"
            role="progressbar"
            aria-label={tr.progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
          >
            <div
              className="h-full rounded-full bg-gold transition-[width] duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          {doc.stages.length > 0 ? (
            <ol className="mt-4 space-y-1.5">
              {doc.stages.map((s, i) => {
                const done = currentIdx >= 0 && i < currentIdx
                const current = i === currentIdx
                return (
                  <li key={s.id} className="flex items-center gap-2 text-sm">
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold ${
                        done
                          ? 'border-success bg-success text-white'
                          : current
                            ? 'border-gold bg-gold text-navy'
                            : 'border-border bg-card text-muted'
                      }`}
                      aria-hidden
                    >
                      {done ? <CheckCircle size={12} weight="fill" /> : i + 1}
                    </span>
                    <span
                      className={
                        current
                          ? 'font-semibold text-foreground'
                          : done
                            ? 'text-foreground'
                            : 'text-muted'
                      }
                    >
                      {stageName(s, lang)}
                    </span>
                  </li>
                )
              })}
            </ol>
          ) : null}
        </section>

        {/* Piece + photo */}
        <section className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-[1fr_140px]">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="text-xs uppercase tracking-wide text-muted">{tr.piece}</div>
            <p className="mt-1 text-base text-foreground">{doc.item_description}</p>
            <div className="mt-3 text-xs uppercase tracking-wide text-muted">{tr.promised}</div>
            <p className="mt-0.5 font-mono text-sm text-foreground">
              {doc.promised_date ? formatDate(doc.promised_date, lang) : tr.promisedNone}
            </p>
          </div>
          {photoUrl ? (
            // Signed URL (1h) from a private bucket — not a next/image host.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photoUrl}
              alt={tr.photoAlt}
              className="aspect-square w-full rounded-xl border border-border object-cover"
            />
          ) : null}
        </section>

        {/* Money */}
        <section className="mt-4 rounded-xl border border-border bg-card p-4">
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">{tr.quoted}</dt>
              <dd className="font-mono text-foreground">
                {doc.quote_amount == null ? tr.notQuoted : formatMoney(doc.quote_amount)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">{tr.paid}</dt>
              <dd className="font-mono text-foreground">{formatMoney(doc.paid_total)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">{tr.balance}</dt>
              <dd className="font-mono text-lg font-bold text-foreground">
                {doc.balance_due == null ? '—' : formatMoney(doc.balance_due)}
              </dd>
            </div>
          </dl>
        </section>

        {/* Contact */}
        <section className="mt-4 rounded-xl border border-border bg-card p-4">
          <p className="text-sm text-foreground">{tr.questions}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {doc.shop.phone ? (
              <a
                href={`tel:${doc.shop.phone.replace(/[^\d+]/g, '')}`}
                className="inline-flex items-center gap-2 rounded-xl bg-gold px-4 py-2 text-sm font-bold text-navy hover:bg-gold-2"
              >
                <Phone size={16} weight="bold" />
                {tr.call} · <span className="font-mono">{doc.shop.phone}</span>
              </a>
            ) : null}
            {doc.shop.public_slug ? (
              <a
                href={`/s/${doc.shop.public_slug}`}
                className="inline-flex items-center gap-1 rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-background"
              >
                {tr.visitSite}
                <ArrowUpRight size={14} weight="bold" />
              </a>
            ) : null}
          </div>
        </section>

        <p className="mt-6 text-center text-[11px] text-muted">{tr.privacyNote}</p>
      </main>
    </>
  )
}

function Banner({
  tone,
  children,
}: {
  tone: 'success' | 'muted'
  children: React.ReactNode
}) {
  return (
    <div
      role="status"
      className={
        tone === 'success'
          ? 'rounded-xl border border-success/40 bg-success/10 px-4 py-3 text-sm font-semibold text-foreground'
          : 'rounded-xl border border-border bg-background px-4 py-3 text-sm text-muted'
      }
    >
      {children}
    </div>
  )
}

const formatDate = (iso: string, lang: 'en' | 'es') =>
  formatCalendarDate(iso, lang, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
