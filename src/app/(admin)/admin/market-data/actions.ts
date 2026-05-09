'use server'

import { getCtx } from '@/lib/supabase/ctx'
import { createAdminClient } from '@/lib/supabase/admin'
import { embedQueryString } from '@/lib/market-data/embed'

export type MarketLookupFilters = {
  query: string
  category: string | null
  state: string | null
  daysBack: number
  similarityThreshold: number
  /** Only fire ANN search when at least this many matches at threshold;
   *  otherwise fall back to text search. Tuneable from the UI. */
}

export type MarketLookupBucket = {
  transaction_type: 'pawn' | 'sale' | 'buy'
  count: number
  p25: number
  p50: number
  p75: number
  mean: number
}

export type MarketLookupSampleRow = {
  transaction_type: 'pawn' | 'sale' | 'buy'
  amount: number
  transaction_date: string
  item_description: string
  item_category: string
  state: string | null
  similarity: number | null
}

export type MarketLookupResult = {
  ok: boolean
  errorMessage: string | null
  filters: MarketLookupFilters
  totalMatches: number
  buckets: MarketLookupBucket[]
  /** Up to 25 sample rows for inspection. NEVER includes
   *  source_tenant_id — strictly anonymous. */
  samples: MarketLookupSampleRow[]
}

type MarketDataPointRow = {
  id: string
  transaction_type: 'pawn' | 'sale' | 'buy'
  amount: string | number
  transaction_date: string
  item_description: string
  item_category: string
  state: string | null
}

type MarketDataPointWithSimilarity = MarketDataPointRow & {
  similarity?: number | null
}

const MAX_SAMPLES = 25

/**
 * Admin-only market data lookup. Embeds the query string, runs cosine-
 * similarity search against market_data_points, aggregates matches into
 * percentile buckets per transaction_type.
 *
 * Defense in depth:
 *   1. Caller must be a superadmin (checked here against profiles.role).
 *   2. RLS on market_data_points further restricts to superadmin-only
 *      reads.
 *   3. We use the admin (service-role) client purely for query
 *      performance; the superadmin gate ABOVE is the actual access
 *      control.
 *   4. source_tenant_id is NEVER included in the SELECT projection.
 */
export async function lookupMarketData(
  filters: MarketLookupFilters,
): Promise<MarketLookupResult> {
  const empty: MarketLookupResult = {
    ok: false,
    errorMessage: null,
    filters,
    totalMatches: 0,
    buckets: [],
    samples: [],
  }

  // Superadmin gate. NEVER skip — admin client below would otherwise
  // bypass RLS entirely.
  const ctx = await getCtx()
  if (!ctx) return { ...empty, errorMessage: 'not_signed_in' }
  if (ctx.globalRole !== 'superadmin') {
    return { ...empty, errorMessage: 'not_superadmin' }
  }

  const admin = createAdminClient()
  const sinceDate = new Date(
    Date.now() - filters.daysBack * 24 * 60 * 60 * 1000,
  )
    .toISOString()
    .slice(0, 10)

  // Embed the query — if no query text, do an unrestricted search
  // limited only by category/state/date filters.
  let queryEmbedding: string | null = null
  if (filters.query.trim().length >= 2) {
    queryEmbedding = await embedQueryString(filters.query)
    if (!queryEmbedding) {
      return {
        ...empty,
        errorMessage: 'embed_failed_check_OPENAI_API_KEY',
      }
    }
  }

  // Build the SELECT. NO source_tenant_id, NO source_row_id.
  const baseColumns =
    'id, transaction_type, amount, transaction_date, item_description, item_category, state'

  let rows: MarketDataPointWithSimilarity[] = []

  if (queryEmbedding) {
    // Vector similarity path. We hand-craft the SQL via .rpc since
    // PostgREST doesn't expose pgvector operators directly.
    // Boundary cast: the RPC + table land in generated types only
    // after `npm run db:types` runs post-migration 0036. Runtime
    // shape matches MarketDataPointWithSimilarity.
    const { data, error } = await admin.rpc(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      'market_data_search_by_embedding' as any,
      {
        p_query: queryEmbedding,
        p_threshold: filters.similarityThreshold,
        p_category: filters.category,
        p_state: filters.state,
        p_since: sinceDate,
        p_limit: 5000,
      },
    )
    if (error) {
      return {
        ...empty,
        errorMessage: `rpc_failed: ${error.message.slice(0, 200)}`,
      }
    }
    rows = (data ?? []) as unknown as MarketDataPointWithSimilarity[]
  } else {
    // No query string — straight filter on category/state/date.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder = (admin.from as any)('market_data_points')
      .select(baseColumns)
      .limit(5000)
    let q = builder
    if (filters.category) q = q.eq('item_category', filters.category)
    if (filters.state) q = q.eq('state', filters.state)
    q = q.gte('transaction_date', sinceDate)
    const { data, error } = await q
    if (error) {
      return {
        ...empty,
        errorMessage: `select_failed: ${error.message.slice(0, 200)}`,
      }
    }
    rows = (data ?? []) as unknown as MarketDataPointWithSimilarity[]
  }

  // Aggregate per transaction_type.
  const byType: Record<
    'pawn' | 'sale' | 'buy',
    number[]
  > = {
    pawn: [],
    sale: [],
    buy: [],
  }
  for (const r of rows) {
    const amt = Number(r.amount)
    if (Number.isFinite(amt) && amt >= 0) {
      byType[r.transaction_type].push(amt)
    }
  }

  const buckets: MarketLookupBucket[] = (
    ['pawn', 'sale', 'buy'] as const
  )
    .map((kind) => {
      const arr = byType[kind].slice().sort((a, b) => a - b)
      if (arr.length === 0) return null
      const mean = arr.reduce((s, x) => s + x, 0) / arr.length
      return {
        transaction_type: kind,
        count: arr.length,
        p25: percentile(arr, 0.25),
        p50: percentile(arr, 0.5),
        p75: percentile(arr, 0.75),
        mean: Math.round(mean * 100) / 100,
      }
    })
    .filter((b): b is MarketLookupBucket => b !== null)

  // Sample rows for the admin to eyeball — top by similarity (when ANN
  // search) or most recent (when text-only).
  const samples: MarketLookupSampleRow[] = rows
    .slice(0, MAX_SAMPLES)
    .map((r) => ({
      transaction_type: r.transaction_type,
      amount: Number(r.amount),
      transaction_date: r.transaction_date,
      item_description: r.item_description,
      item_category: r.item_category,
      state: r.state,
      similarity: r.similarity ?? null,
    }))

  return {
    ok: true,
    errorMessage: null,
    filters,
    totalMatches: rows.length,
    buckets,
    samples,
  }
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.floor(p * sortedAsc.length)),
  )
  return Math.round(sortedAsc[idx] * 100) / 100
}
