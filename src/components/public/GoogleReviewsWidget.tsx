// src/components/public/GoogleReviewsWidget.tsx
'use client'

import { Star, ArrowUpRight } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import {
  formatRelativeTime,
  truncateExcerpt,
  starArray,
} from '@/lib/google-reviews/format'
import type { RenderableReviews } from '@/lib/google-reviews/types'

export default function GoogleReviewsWidget({
  data,
}: {
  data: RenderableReviews
}) {
  const { t, lang } = useI18n()
  const dict = t.landing.reviews

  // Defense-in-depth — caller already guarantees ≥1 review per Decision 4.
  if (data.reviews.length === 0) return null

  const countLabel =
    data.totalReviewCount === 1 ? dict.count.one : dict.count.other

  return (
    <section className="mb-10 rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold tracking-[-0.01em] text-foreground">
            {dict.title}
          </h2>
          <div className="flex items-center gap-2">
            <Stars rating={Math.round(data.rating)} size={14} />
            <span className="text-sm font-medium text-foreground">
              {data.rating.toFixed(1)}
            </span>
            <span className="text-sm text-muted">·</span>
            <span className="text-sm text-muted">
              {data.totalReviewCount} {countLabel}
            </span>
          </div>
        </div>
        {data.placeUrl ? (
          <a
            href={data.placeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm font-medium text-blue hover:underline"
          >
            {dict.seeAll}
            <ArrowUpRight size={14} weight="bold" />
          </a>
        ) : null}
      </div>

      <ul className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
        {data.reviews.map((r, i) => (
          <li
            key={`${r.time}-${i}`}
            className="rounded-lg border border-border bg-background p-4"
          >
            <div className="flex items-center gap-2">
              <Stars rating={Math.round(r.rating)} size={12} />
            </div>
            <div className="mt-2 flex items-baseline justify-between gap-2">
              <span className="truncate text-sm font-medium text-foreground">
                {r.author_name?.trim() || dict.anonymous}
              </span>
              <span className="text-xs text-muted">
                {formatRelativeTime(r.time, lang)}
              </span>
            </div>
            {r.text ? (
              <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                {truncateExcerpt(r.text, 140)}
              </p>
            ) : null}
            {data.placeUrl ? (
              <a
                href={r.author_url ?? data.placeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-blue hover:underline"
              >
                {dict.readFull}
                <ArrowUpRight size={12} weight="bold" />
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}

function Stars({ rating, size }: { rating: number; size: number }) {
  const arr = starArray(rating)
  return (
    <span className="inline-flex items-center gap-0.5">
      {arr.map((filled, i) => (
        <Star
          key={i}
          size={size}
          weight="fill"
          className={filled ? 'text-foreground' : 'text-border'}
        />
      ))}
    </span>
  )
}
