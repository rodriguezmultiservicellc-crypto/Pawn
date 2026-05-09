'use client'

import { useState, useTransition } from 'react'
import {
  ChartBar,
  Database,
  MagnifyingGlass,
  Warning,
} from '@phosphor-icons/react'
import {
  lookupMarketData,
  type MarketLookupBucket,
  type MarketLookupResult,
  type MarketLookupSampleRow,
} from './actions'

const CATEGORIES: Array<{ value: string; label: string }> = [
  { value: '', label: 'All categories' },
  { value: 'ring', label: 'Ring' },
  { value: 'necklace', label: 'Necklace' },
  { value: 'bracelet', label: 'Bracelet' },
  { value: 'earrings', label: 'Earrings' },
  { value: 'pendant', label: 'Pendant' },
  { value: 'chain', label: 'Chain' },
  { value: 'watch', label: 'Watch' },
  { value: 'coin', label: 'Coin' },
  { value: 'bullion', label: 'Bullion' },
  { value: 'loose_stone', label: 'Loose stone' },
  { value: 'electronics', label: 'Electronics' },
  { value: 'tool', label: 'Tool' },
  { value: 'instrument', label: 'Instrument' },
  { value: 'other', label: 'Other' },
]

const DAYS_BACK_OPTIONS = [30, 90, 180, 365, 730]

export default function MarketDataContent({
  stats,
}: {
  stats: {
    totalRows: number
    pendingEmbed: number
    lastDayRows: number
  }
}) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [daysBack, setDaysBack] = useState(90)
  const [threshold, setThreshold] = useState(0.3)
  const [result, setResult] = useState<MarketLookupResult | null>(null)
  const [isPending, startTransition] = useTransition()

  function onSearch(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const r = await lookupMarketData({
        query,
        category: category || null,
        state: stateFilter.trim() ? stateFilter.trim().toUpperCase() : null,
        daysBack,
        similarityThreshold: threshold,
      })
      setResult(r)
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-navy">
          Market data
        </h1>
        <p className="mt-1 text-sm text-muted">
          Cross-tenant pricing aggregation. Superadmin only — never exposed
          to operators. See patches/0036 for the warehouse design.
        </p>
      </div>

      {/* WAREHOUSE STATUS */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatusTile
          icon={<Database size={16} weight="regular" />}
          label="Total data points"
          value={stats.totalRows.toLocaleString()}
        />
        <StatusTile
          icon={<ChartBar size={16} weight="regular" />}
          label="Last 24 hours"
          value={stats.lastDayRows.toLocaleString()}
        />
        <StatusTile
          icon={<Warning size={16} weight="regular" />}
          label="Pending embedding"
          value={stats.pendingEmbed.toLocaleString()}
          tone={stats.pendingEmbed > 200 ? 'warning' : 'neutral'}
        />
      </div>

      {/* SEARCH FORM */}
      <form
        onSubmit={onSearch}
        className="rounded-xl border border-border bg-card p-5"
      >
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
              Search query (item description)
            </label>
            <div className="relative mt-1">
              <MagnifyingGlass
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
              />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder='e.g. "iPhone 7 64GB blue" or "14k rope chain 5g"'
                className="w-full rounded-xl border-2 border-border bg-background py-3 pl-9 pr-4 text-sm text-foreground outline-none transition-colors focus:border-blue"
              />
            </div>
            <p className="mt-1 text-[11px] text-muted">
              Empty query = filter-only (no vector similarity). Min 2 chars
              to enable similarity search.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
                Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="mt-1 w-full rounded-xl border-2 border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-blue"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
                State
              </label>
              <input
                type="text"
                maxLength={2}
                value={stateFilter}
                onChange={(e) => setStateFilter(e.target.value)}
                placeholder="FL"
                className="mt-1 w-full rounded-xl border-2 border-border bg-background px-3 py-2 text-sm uppercase text-foreground outline-none focus:border-blue"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
                Days back
              </label>
              <select
                value={daysBack}
                onChange={(e) => setDaysBack(parseInt(e.target.value, 10))}
                className="mt-1 w-full rounded-xl border-2 border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-blue"
              >
                {DAYS_BACK_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    Last {d} days
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
                Similarity threshold ({threshold.toFixed(2)})
              </label>
              <input
                type="range"
                min={0.1}
                max={0.5}
                step={0.05}
                value={threshold}
                onChange={(e) => setThreshold(parseFloat(e.target.value))}
                className="mt-3 w-full"
              />
              <p className="mt-0.5 text-[10px] text-muted">
                Lower = stricter match. 0.3 default.
              </p>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-gold px-4 py-2 text-sm font-semibold text-navy transition-colors hover:bg-gold-2 disabled:opacity-50"
            >
              {isPending ? 'Searching…' : 'Run lookup'}
            </button>
          </div>
        </div>
      </form>

      {/* RESULTS */}
      {result ? (
        <div className="space-y-5">
          {result.errorMessage ? (
            <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
              {result.errorMessage}
            </div>
          ) : (
            <>
              <div className="text-sm text-muted">
                {result.totalMatches.toLocaleString()} matches found.
              </div>

              {/* PERCENTILE BUCKETS PER TRANSACTION TYPE */}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {result.buckets.map((b) => (
                  <BucketCard key={b.transaction_type} bucket={b} />
                ))}
              </div>

              {/* SAMPLE ROWS */}
              {result.samples.length > 0 ? (
                <section className="rounded-xl border border-border bg-card">
                  <header className="border-b border-border px-5 py-3">
                    <h2 className="font-display text-lg font-bold text-navy">
                      Sample matches
                    </h2>
                    <p className="text-xs text-muted">
                      Top {result.samples.length} of {result.totalMatches}.
                      Anonymized — no shop attribution.
                    </p>
                  </header>
                  <ul className="divide-y divide-border">
                    {result.samples.map((s, i) => (
                      <SampleRow key={i} row={s} />
                    ))}
                  </ul>
                </section>
              ) : null}
            </>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-card/50 p-12 text-center text-sm text-muted">
          Enter a query above and run the lookup.
        </div>
      )}
    </div>
  )
}

function StatusTile({
  icon,
  label,
  value,
  tone = 'neutral',
}: {
  icon: React.ReactNode
  label: string
  value: string
  tone?: 'neutral' | 'warning'
}) {
  const border =
    tone === 'warning' ? 'border-warning/40 bg-warning/5' : 'border-border bg-card'
  const valueColor = tone === 'warning' ? 'text-warning' : 'text-foreground'
  return (
    <div className={`flex items-center gap-3 rounded-xl border p-4 ${border}`}>
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-navy/5 text-navy">
        {icon}
      </span>
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-muted">
          {label}
        </div>
        <div className={`font-mono text-xl font-bold ${valueColor}`}>
          {value}
        </div>
      </div>
    </div>
  )
}

function BucketCard({ bucket }: { bucket: MarketLookupBucket }) {
  const palette: Record<MarketLookupBucket['transaction_type'], string> = {
    pawn: 'border-gold/40 bg-gold/5',
    sale: 'border-success/40 bg-success/5',
    buy: 'border-blue/40 bg-blue/5',
  }
  const titleMap = {
    pawn: 'Pawn loans',
    sale: 'Retail sales',
    buy: 'Buy-outright',
  } as const
  return (
    <div className={`rounded-xl border p-4 ${palette[bucket.transaction_type]}`}>
      <div className="flex items-center justify-between">
        <h3 className="font-display text-base font-bold text-navy">
          {titleMap[bucket.transaction_type]}
        </h3>
        <span className="font-mono text-xs text-muted">
          n = {bucket.count}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <Stat label="P25" value={formatMoney(bucket.p25)} />
        <Stat label="Median" value={formatMoney(bucket.p50)} />
        <Stat label="P75" value={formatMoney(bucket.p75)} />
        <Stat label="Mean" value={formatMoney(bucket.mean)} />
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </div>
      <div className="font-mono text-base font-bold text-foreground">
        {value}
      </div>
    </div>
  )
}

function SampleRow({ row }: { row: MarketLookupSampleRow }) {
  const typeColor: Record<MarketLookupSampleRow['transaction_type'], string> = {
    pawn: 'bg-gold/10 text-gold',
    sale: 'bg-success/10 text-success',
    buy: 'bg-blue/10 text-blue',
  }
  return (
    <li className="flex items-center gap-3 px-5 py-2 text-sm">
      <span
        className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold uppercase ${typeColor[row.transaction_type]}`}
      >
        {row.transaction_type}
      </span>
      <span className="shrink-0 font-mono text-sm text-foreground">
        {formatMoney(row.amount)}
      </span>
      <span className="min-w-0 flex-1 truncate text-foreground">
        {row.item_description}
      </span>
      <span className="shrink-0 text-xs text-muted">{row.item_category}</span>
      {row.state ? (
        <span className="shrink-0 font-mono text-xs text-muted">
          {row.state}
        </span>
      ) : null}
      <span className="shrink-0 text-xs text-muted">
        {new Date(row.transaction_date).toLocaleDateString()}
      </span>
      {row.similarity != null ? (
        <span className="shrink-0 font-mono text-xs text-muted">
          {row.similarity.toFixed(2)}
        </span>
      ) : null}
    </li>
  )
}

function formatMoney(v: number): string {
  if (!isFinite(v)) return '—'
  return v.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}
