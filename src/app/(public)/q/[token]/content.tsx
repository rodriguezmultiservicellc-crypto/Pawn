'use client'

import { useEffect, useRef } from 'react'
import { ArrowUpRight, Phone, Storefront } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { formatMoney } from '@/lib/format/money'
import { formatCalendarDate } from '@/lib/format/date'
import type { PublicQuote } from '@/lib/custom-quotes/public-quote'
import LanguageToggle from '@/app/(public)/s/[slug]/LanguageToggle'

export default function QuotePublicContent({
  doc,
  photoUrl,
}: {
  doc: PublicQuote
  photoUrl: string | null
}) {
  const { t, lang, setLang } = useI18n()
  const tq = t.quotePublic
  const cats = t.quotes.categories as Record<string, string>

  const applied = useRef(false)
  useEffect(() => {
    if (applied.current) return
    applied.current = true
    if (doc.language !== lang) setLang(doc.language)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const banner =
    doc.status === 'expired'
      ? { tone: 'muted' as const, text: tq.expired }
      : doc.status === 'accepted'
        ? { tone: 'success' as const, text: tq.accepted }
        : doc.status === 'converted'
          ? { tone: 'success' as const, text: tq.converted }
          : doc.status === 'declined'
            ? { tone: 'muted' as const, text: tq.declined }
            : null

  return (
    <>
      <header className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            {doc.shop.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={doc.shop.logo_url} alt="" className="h-9 w-9 rounded-md object-cover" />
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
          <div className="text-xs uppercase tracking-wide text-muted">{tq.title}</div>
          <h1 className="font-display text-2xl font-bold text-foreground sm:text-3xl">
            {tq.quote} <span className="font-mono">{doc.quote_number}</span>
          </h1>
          <p className="mt-1 text-sm text-muted">{cats[doc.category] ?? doc.category}</p>
        </div>

        {banner ? (
          <div
            role="status"
            className={
              banner.tone === 'success'
                ? 'rounded-xl border border-success/40 bg-success/10 px-4 py-3 text-sm font-semibold text-foreground'
                : 'rounded-xl border border-border bg-background px-4 py-3 text-sm text-muted'
            }
          >
            {banner.text}
          </div>
        ) : null}

        <section className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-[1fr_140px]">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="text-xs uppercase tracking-wide text-muted">{tq.piece}</div>
            <p className="mt-1 text-base text-foreground">{doc.description}</p>
            {doc.size ? (
              <>
                <div className="mt-3 text-xs uppercase tracking-wide text-muted">{tq.size}</div>
                <p className="mt-0.5 text-sm text-foreground">{doc.size}</p>
              </>
            ) : null}
          </div>
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photoUrl}
              alt={tq.photoAlt}
              className="aspect-square w-full rounded-xl border border-border object-cover"
            />
          ) : null}
        </section>

        <section className="mt-4 rounded-xl border border-border bg-card p-4">
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-xs uppercase tracking-wide text-muted">{tq.total}</div>
            <div className="font-mono text-3xl font-bold text-foreground">{formatMoney(doc.price_total)}</div>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">{tq.deposit}</dt>
              <dd className="font-mono text-foreground">{formatMoney(doc.deposit_amount)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">{tq.balance}</dt>
              <dd className="font-mono text-foreground">{formatMoney(doc.balance_due)}</dd>
            </div>
            {doc.expires_on ? (
              <div className="col-span-2">
                <dt className="text-xs uppercase tracking-wide text-muted">{tq.validUntil}</dt>
                <dd className="font-mono text-foreground">{formatDate(doc.expires_on, lang)}</dd>
              </div>
            ) : null}
          </dl>
          {doc.spot_price_per_gram != null && doc.spot_priced_at ? (
            <p className="mt-3 text-xs text-muted">
              {tq.pricedAt
                .replace('{price}', formatMoney(doc.spot_price_per_gram))
                .replace('{date}', formatDate(doc.spot_priced_at.slice(0, 10), lang))}
            </p>
          ) : null}
        </section>

        {doc.lines.length > 0 ? (
          <section className="mt-4 rounded-xl border border-border bg-card p-4">
            <div className="text-xs uppercase tracking-wide text-muted">{tq.breakdown}</div>
            <ul className="mt-2 divide-y divide-border text-sm">
              {doc.lines.map((l, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="text-foreground">
                    {l.label}
                    {l.quantity !== 1 ? <span className="ml-1 text-muted">× {l.quantity}</span> : null}
                  </span>
                  <span className="font-mono text-foreground">{formatMoney(l.price_total)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="mt-4 rounded-xl border border-border bg-card p-4">
          <p className="text-sm text-foreground">{tq.questions}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {doc.shop.phone ? (
              <a
                href={`tel:${doc.shop.phone.replace(/[^\d+]/g, '')}`}
                className="inline-flex items-center gap-2 rounded-xl bg-gold px-4 py-2 text-sm font-bold text-navy hover:bg-gold-2"
              >
                <Phone size={16} weight="bold" />
                {tq.call} · <span className="font-mono">{doc.shop.phone}</span>
              </a>
            ) : null}
            {doc.shop.public_slug ? (
              <a
                href={`/s/${doc.shop.public_slug}`}
                className="inline-flex items-center gap-1 rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-background"
              >
                {tq.visitSite}
                <ArrowUpRight size={14} weight="bold" />
              </a>
            ) : null}
          </div>
        </section>

        <p className="mt-6 text-center text-[11px] text-muted">{tq.privacyNote}</p>
      </main>
    </>
  )
}

const formatDate = (iso: string, lang: 'en' | 'es') => formatCalendarDate(iso, lang)
