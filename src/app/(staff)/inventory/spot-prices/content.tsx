'use client'

import { useActionState, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowClockwise,
  ArrowLeft,
  Eye,
  EyeSlash,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { formatMoney, shortDateTime } from '@/lib/format/money'
import {
  refreshSpotPricesAction,
  saveSpotOverrideAction,
  type RefreshNowState,
  type SaveOverrideState,
} from './actions'
import type { MetalPurity, MetalType } from '@/types/database-aliases'

const HIDDEN_KEY = 'pawn.spot-prices.hidden'

function cardKey(metal: MetalType, purity: MetalPurity): string {
  return `${metal}::${purity}`
}

function readPersistedHidden(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(HIDDEN_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as string[]) : []
  } catch {
    return []
  }
}

export type SpotPriceCard = {
  metal_type: MetalType
  purity: MetalPurity
  /** Strings come back from supabase numeric columns. */
  price_per_gram: string | null
  price_per_troy_oz: string | null
  currency: string
  source: string | null
  fetched_at: string | null
  /** Tenant override multiplier, default '1.0000'. */
  multiplier: string
}

export type SpotPriceHistoryPoint = {
  metal_type: MetalType
  purity: MetalPurity
  fetched_at: string
  price_per_gram: string
}

export type SpotPriceOverrideTuple = {
  metal_type: MetalType
  purity: MetalPurity
  multiplier: string
}

export default function SpotPricesContent({
  cards,
  history,
  overrides,
  canRefresh,
}: {
  cards: SpotPriceCard[]
  history: SpotPriceHistoryPoint[]
  overrides: SpotPriceOverrideTuple[]
  canRefresh: boolean
}) {
  const { t } = useI18n()

  // Hidden card list, persisted in localStorage so each operator can
  // tailor what they want to see without it being stored server-side.
  const [hidden, setHidden] = useState<Set<string>>(
    () => new Set(readPersistedHidden()),
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(HIDDEN_KEY, JSON.stringify(Array.from(hidden)))
    } catch {
      // ignore — quota / private mode etc.
    }
  }, [hidden])

  const toggleHidden = (key: string) => {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const showAll = () => setHidden(new Set())

  // Featured "headline" — 24K pure gold per oz. Always rendered if we have
  // a row for it, regardless of the hidden set (it's the anchor price).
  const headline =
    cards.find(
      (c) => c.metal_type === 'gold' && c.purity === 'pure_24k',
    ) ?? null

  const visibleCards = cards.filter(
    (c) => !hidden.has(cardKey(c.metal_type, c.purity)),
  )
  const hiddenCards = cards.filter((c) =>
    hidden.has(cardKey(c.metal_type, c.purity)),
  )

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/inventory"
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft size={14} weight="bold" />
          {t.spotPrices.backToInventory}
        </Link>
        {canRefresh ? <RefreshNowButton /> : null}
      </div>

      <div>
        <h1 className="font-display text-2xl font-bold">{t.spotPrices.title}</h1>
        <p className="mt-1 text-sm text-muted">{t.spotPrices.subtitle}</p>
      </div>

      {headline ? <HeadlinePanel card={headline} /> : null}

      <SpotGrid
        cards={visibleCards}
        history={history}
        hidden={hidden}
        onToggleHidden={toggleHidden}
      />

      {hiddenCards.length > 0 ? (
        <HiddenPanel
          cards={hiddenCards}
          onUnhide={toggleHidden}
          onShowAll={showAll}
        />
      ) : null}

      <OverridesPanel overrides={overrides} />
    </div>
  )
}

/**
 * Featured 24K-gold-per-oz panel rendered above the per-purity grid.
 * The "anchor price" most operators glance at first thing in the
 * morning to decide pawn buy rates. Always visible — not part of the
 * hidden-cards toggle.
 */
function HeadlinePanel({ card }: { card: SpotPriceCard }) {
  const { t } = useI18n()
  const perOz = card.price_per_troy_oz ? Number(card.price_per_troy_oz) : null
  const perGram = card.price_per_gram ? Number(card.price_per_gram) : null
  const multiplier = Number(card.multiplier)
  const overrideActive = isFinite(multiplier) && multiplier !== 1

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-gradient-to-br from-canvas to-cloud/40 p-6">
      <div className="flex flex-col items-center text-center">
        <div className="text-xs font-bold uppercase tracking-widest text-muted">
          {t.spotPrices.metals.gold ?? 'Gold'}
          {' · '}
          {t.spotPrices.purities.pure_24k ?? '24K'}
        </div>
        <div className="mt-2 font-mono text-5xl font-bold tabular-nums text-foreground md:text-6xl">
          {perOz == null ? '—' : formatMoney(perOz)}
        </div>
        <div className="mt-1 text-sm text-muted">
          {t.spotPrices.perOz}
          {perGram != null ? (
            <span className="ml-3 font-mono text-xs">
              ({formatMoney(perGram)} {t.spotPrices.perGram})
            </span>
          ) : null}
        </div>
        <div className="mt-2 flex items-center gap-2 text-[11px] text-muted">
          {card.fetched_at ? (
            <span>
              {t.spotPrices.lastFetched}: {shortDateTime(card.fetched_at)}
            </span>
          ) : (
            <span>{t.spotPrices.neverFetched}</span>
          )}
          {card.source ? (
            <span className="font-mono text-muted/80">({card.source})</span>
          ) : null}
          {overrideActive ? (
            <span className="rounded-md bg-warning/10 px-2 py-0.5 font-mono text-warning">
              ×{multiplier.toFixed(4)} override
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function HiddenPanel({
  cards,
  onUnhide,
  onShowAll,
}: {
  cards: SpotPriceCard[]
  onUnhide: (key: string) => void
  onShowAll: () => void
}) {
  const { t } = useI18n()
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-muted">
          {cards.length} hidden{' '}
          <span className="text-muted/60">
            (click to show)
          </span>
        </div>
        <button
          type="button"
          onClick={onShowAll}
          className="text-xs font-medium text-gold hover:underline"
        >
          Show all
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {cards.map((c) => {
          const key = cardKey(c.metal_type, c.purity)
          return (
            <button
              key={key}
              type="button"
              onClick={() => onUnhide(key)}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[11px] text-foreground hover:bg-background"
              title="Show this card"
            >
              <Eye size={10} weight="bold" className="text-muted" />
              {t.spotPrices.metals[c.metal_type] ?? c.metal_type}
              {' · '}
              {t.spotPrices.purities[c.purity] ?? c.purity}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function RefreshNowButton() {
  const { t } = useI18n()
  const [state, action, pending] = useActionState<RefreshNowState, FormData>(
    refreshSpotPricesAction,
    {},
  )
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-md bg-gold px-3 py-1.5 text-sm text-navy font-medium hover:bg-gold-2 disabled:opacity-50"
      >
        <ArrowClockwise size={14} weight="bold" />
        {pending ? t.spotPrices.refreshing : t.spotPrices.refreshNow}
      </button>
      {state.summary ? (
        <span className="font-mono text-xs text-muted">
          {state.summary.ok
            ? t.spotPrices.refreshOk
                .replace('{inserted}', String(state.summary.inserted))
                .replace('{attempted}', String(state.summary.attempted))
            : (state.error ?? t.spotPrices.refreshFailed)}
        </span>
      ) : null}
    </form>
  )
}

function SpotGrid({
  cards,
  history,
  hidden,
  onToggleHidden,
}: {
  cards: SpotPriceCard[]
  history: SpotPriceHistoryPoint[]
  hidden: Set<string>
  onToggleHidden: (key: string) => void
}) {
  const { t } = useI18n()
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => (
        <SpotCard
          key={`${card.metal_type}::${card.purity}`}
          card={card}
          history={history}
          isHidden={hidden.has(cardKey(card.metal_type, card.purity))}
          onToggleHidden={() =>
            onToggleHidden(cardKey(card.metal_type, card.purity))
          }
        />
      ))}
      {cards.length === 0 ? (
        <div className="col-span-full rounded-xl border border-border bg-card p-6 text-center text-sm text-muted">
          {t.spotPrices.noPrices}
        </div>
      ) : null}
    </div>
  )
}

function SpotCard({
  card,
  history,
  isHidden,
  onToggleHidden,
}: {
  card: SpotPriceCard
  history: SpotPriceHistoryPoint[]
  isHidden: boolean
  onToggleHidden: () => void
}) {
  const { t } = useI18n()
  const points = useMemo(
    () =>
      history.filter(
        (h) => h.metal_type === card.metal_type && h.purity === card.purity,
      ),
    [history, card.metal_type, card.purity],
  )

  const perGram = card.price_per_gram ? Number(card.price_per_gram) : null
  const perOz = card.price_per_troy_oz ? Number(card.price_per_troy_oz) : null

  return (
    <div className="group relative rounded-xl border border-border bg-card p-4">
      <button
        type="button"
        onClick={onToggleHidden}
        className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-md text-muted/50 opacity-0 transition hover:bg-background hover:text-foreground focus:opacity-100 group-hover:opacity-100"
        title={isHidden ? 'Show this card' : 'Hide this card'}
        aria-label={isHidden ? 'Show this card' : 'Hide this card'}
      >
        {isHidden ? (
          <Eye size={12} weight="bold" />
        ) : (
          <EyeSlash size={12} weight="bold" />
        )}
      </button>

      <div className="flex items-baseline justify-between pr-6">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted">
            {t.spotPrices.metals[card.metal_type] ?? card.metal_type}
          </div>
          <div className="text-base font-semibold text-foreground">
            {t.spotPrices.purities[card.purity] ?? card.purity}
          </div>
        </div>
        {Number(card.multiplier) !== 1 ? (
          <span className="rounded-md bg-warning/10 px-2 py-0.5 font-mono text-xs text-warning">
            ×{Number(card.multiplier).toFixed(4)}
          </span>
        ) : null}
      </div>

      <div className="mt-3">
        <div className="font-mono text-2xl font-semibold text-foreground">
          {perGram == null ? '—' : formatMoney(perGram)}
          <span className="ml-1 text-xs font-normal text-muted">
            {t.spotPrices.perGram}
          </span>
        </div>
        <div className="font-mono text-xs text-muted">
          {perOz == null ? '—' : formatMoney(perOz)} {t.spotPrices.perOz}
        </div>
      </div>

      <Sparkline points={points} />

      <div className="mt-2 text-xs text-muted">
        {card.fetched_at
          ? `${t.spotPrices.lastFetched}: ${shortDateTime(card.fetched_at)}`
          : t.spotPrices.neverFetched}
        {card.source ? (
          <span className="ml-2 font-mono text-muted/80">({card.source})</span>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Tiny inline sparkline. SVG; no chart library required. We render
 * relative bands to fit the card, falling back to a flat hairline when
 * there aren't enough points.
 */
function Sparkline({ points }: { points: SpotPriceHistoryPoint[] }) {
  if (points.length < 2) {
    return (
      <div className="mt-3 h-8 rounded border border-border bg-background" />
    )
  }
  const values = points.map((p) => Number(p.price_per_gram))
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = Math.max(0.0001, max - min)
  const W = 200
  const H = 32
  const path = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * W
      const y = H - ((Number(p.price_per_gram) - min) / range) * H
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')

  return (
    <svg
      role="img"
      aria-label="24h price trend"
      viewBox={`0 0 ${W} ${H}`}
      className="mt-3 h-8 w-full"
    >
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        className="text-gold"
      />
    </svg>
  )
}

function OverridesPanel({
  overrides,
}: {
  overrides: SpotPriceOverrideTuple[]
}) {
  const { t } = useI18n()
  return (
    <fieldset className="rounded-xl border border-border bg-card p-4">
      <legend className="px-1 text-sm font-semibold text-foreground">
        {t.spotPrices.overridesTitle}
      </legend>
      <p className="mt-1 text-xs text-muted">{t.spotPrices.overridesHelp}</p>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {overrides.map((o) => (
          <OverrideRow
            key={`${o.metal_type}::${o.purity}`}
            metalType={o.metal_type}
            purity={o.purity}
            initialMultiplier={o.multiplier}
          />
        ))}
      </div>
    </fieldset>
  )
}

function OverrideRow({
  metalType,
  purity,
  initialMultiplier,
}: {
  metalType: MetalType
  purity: MetalPurity
  initialMultiplier: string
}) {
  const { t } = useI18n()
  const [state, action, pending] = useActionState<SaveOverrideState, FormData>(
    saveSpotOverrideAction,
    {},
  )
  const [pct, setPct] = useState(() => {
    const m = Number(initialMultiplier)
    if (!isFinite(m)) return '100'
    return (m * 100).toFixed(2)
  })

  return (
    <form action={action} className="rounded-md border border-border bg-background/40 p-3">
      <input type="hidden" name="metal_type" value={metalType} />
      <input type="hidden" name="purity" value={purity} />
      <div className="mb-2 text-xs text-muted">
        <span className="font-medium text-foreground">
          {t.spotPrices.metals[metalType] ?? metalType}
        </span>
        {' · '}
        {t.spotPrices.purities[purity] ?? purity}
      </div>
      <div className="flex items-center gap-2">
        <input
          name="multiplier_pct"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          max="200"
          value={pct}
          onChange={(e) => setPct(e.target.value)}
          className="h-8 w-20 rounded-md border border-border bg-card px-2 font-mono text-sm text-foreground focus:border-blue focus:outline-none"
          aria-label={t.spotPrices.multiplierLabel}
        />
        <span className="text-xs text-muted">%</span>
        <button
          type="submit"
          disabled={pending}
          className="ml-auto rounded-md border border-border bg-card px-3 py-1 text-xs font-medium text-foreground hover:bg-background disabled:opacity-50"
        >
          {pending ? t.common.saving : t.common.save}
        </button>
      </div>
      {state.error ? (
        <div className="mt-1 text-xs text-danger">{state.error}</div>
      ) : null}
      {state.ok ? (
        <div className="mt-1 text-xs text-success">{t.common.save} ✓</div>
      ) : null}
    </form>
  )
}
