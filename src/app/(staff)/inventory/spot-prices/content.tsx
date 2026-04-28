'use client'

import { useActionState, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowClockwise, ArrowLeft } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { formatMoney, shortDateTime } from '@/lib/format/money'
import {
  refreshSpotPricesAction,
  saveSpotOverrideAction,
  type RefreshNowState,
  type SaveOverrideState,
} from './actions'
import type { MetalPurity, MetalType } from '@/types/database-aliases'

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

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/inventory"
          className="inline-flex items-center gap-1 text-sm text-ash hover:text-ink"
        >
          <ArrowLeft size={14} weight="bold" />
          {t.spotPrices.backToInventory}
        </Link>
        {canRefresh ? <RefreshNowButton /> : null}
      </div>

      <div>
        <h1 className="text-2xl font-bold">{t.spotPrices.title}</h1>
        <p className="mt-1 text-sm text-ash">{t.spotPrices.subtitle}</p>
      </div>

      <SpotGrid cards={cards} history={history} />

      <OverridesPanel overrides={overrides} />
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
        className="inline-flex items-center gap-2 rounded-md bg-rausch px-3 py-1.5 text-sm text-canvas font-medium hover:bg-rausch-deep disabled:opacity-50"
      >
        <ArrowClockwise size={14} weight="bold" />
        {pending ? t.spotPrices.refreshing : t.spotPrices.refreshNow}
      </button>
      {state.summary ? (
        <span className="font-mono text-xs text-ash">
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
}: {
  cards: SpotPriceCard[]
  history: SpotPriceHistoryPoint[]
}) {
  const { t } = useI18n()
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => (
        <SpotCard
          key={`${card.metal_type}::${card.purity}`}
          card={card}
          history={history}
        />
      ))}
      {cards.length === 0 ? (
        <div className="col-span-full rounded-lg border border-hairline bg-canvas p-6 text-center text-sm text-ash">
          {t.spotPrices.noPrices}
        </div>
      ) : null}
    </div>
  )
}

function SpotCard({
  card,
  history,
}: {
  card: SpotPriceCard
  history: SpotPriceHistoryPoint[]
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
    <div className="rounded-lg border border-hairline bg-canvas p-4">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-ash">
            {t.spotPrices.metals[card.metal_type] ?? card.metal_type}
          </div>
          <div className="text-base font-semibold text-ink">
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
        <div className="font-mono text-2xl font-semibold text-ink">
          {perGram == null ? '—' : formatMoney(perGram)}
          <span className="ml-1 text-xs font-normal text-ash">
            {t.spotPrices.perGram}
          </span>
        </div>
        <div className="font-mono text-xs text-ash">
          {perOz == null ? '—' : formatMoney(perOz)} {t.spotPrices.perOz}
        </div>
      </div>

      <Sparkline points={points} />

      <div className="mt-2 text-xs text-ash">
        {card.fetched_at
          ? `${t.spotPrices.lastFetched}: ${shortDateTime(card.fetched_at)}`
          : t.spotPrices.neverFetched}
        {card.source ? (
          <span className="ml-2 font-mono text-ash/80">({card.source})</span>
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
      <div className="mt-3 h-8 rounded border border-hairline bg-cloud" />
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
        className="text-rausch"
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
    <fieldset className="rounded-lg border border-hairline bg-canvas p-4">
      <legend className="px-1 text-sm font-semibold text-ink">
        {t.spotPrices.overridesTitle}
      </legend>
      <p className="mt-1 text-xs text-ash">{t.spotPrices.overridesHelp}</p>
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
    <form action={action} className="rounded-md border border-hairline bg-cloud/40 p-3">
      <input type="hidden" name="metal_type" value={metalType} />
      <input type="hidden" name="purity" value={purity} />
      <div className="mb-2 text-xs text-ash">
        <span className="font-medium text-ink">
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
          className="h-8 w-20 rounded-md border border-hairline bg-canvas px-2 font-mono text-sm text-ink focus:border-ink focus:outline-none"
          aria-label={t.spotPrices.multiplierLabel}
        />
        <span className="text-xs text-ash">%</span>
        <button
          type="submit"
          disabled={pending}
          className="ml-auto rounded-md border border-hairline bg-canvas px-3 py-1 text-xs font-medium text-ink hover:bg-cloud disabled:opacity-50"
        >
          {pending ? t.common.saving : t.common.save}
        </button>
      </div>
      {state.error ? (
        <div className="mt-1 text-xs text-error">{state.error}</div>
      ) : null}
      {state.ok ? (
        <div className="mt-1 text-xs text-success">{t.common.save} ✓</div>
      ) : null}
    </form>
  )
}
