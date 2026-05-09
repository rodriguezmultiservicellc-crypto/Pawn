import 'server-only'

import OpenAI from 'openai'
import { createAdminClient } from '@/lib/supabase/admin'

const EMBED_MODEL = 'text-embedding-3-small'
const EMBED_DIMS = 1536
const BATCH_SIZE = 50

export type EmbedRunResult = {
  scanned: number
  embedded: number
  failed: number
  errors: string[]
}

/**
 * Find market_data_points rows with item_embedding IS NULL, batch them
 * through OpenAI text-embedding-3-small, write the vectors back.
 *
 * Called by /api/cron/embed-market-data on a 15-minute schedule. Idempotent:
 * if the cron crashes mid-batch, the unembedded rows are picked up next run.
 *
 * Service-role admin client is required because market_data_points has no
 * INSERT/UPDATE policies for authenticated users — only the service-role
 * key can write the embedding back.
 */
export async function embedPendingMarketData(): Promise<EmbedRunResult> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return {
      scanned: 0,
      embedded: 0,
      failed: 0,
      errors: ['OPENAI_API_KEY not set — embed run skipped'],
    }
  }

  const admin = createAdminClient()
  const openai = new OpenAI({ apiKey })

  // Pull a batch of unembedded rows. Order by created_at so the
  // backlog drains FIFO.
  // Boundary cast: `market_data_points` won't appear in generated
  // database types until `npm run db:types` runs after migration 0036
  // is applied. The runtime shape matches the inline cast below.
  const { data, error: selectErr } = await admin
    .from('market_data_points' as never)
    .select('id, item_description')
    .is('item_embedding', null)
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE)
  const rows =
    data == null
      ? null
      : (data as unknown as Array<{ id: string; item_description: string }>)

  if (selectErr) {
    return {
      scanned: 0,
      embedded: 0,
      failed: 0,
      errors: [`select failed: ${selectErr.message}`],
    }
  }
  if (!rows || rows.length === 0) {
    return { scanned: 0, embedded: 0, failed: 0, errors: [] }
  }

  // OpenAI accepts an array of inputs in one call — much cheaper than
  // calling once per row.
  let response
  try {
    response = await openai.embeddings.create({
      model: EMBED_MODEL,
      input: rows.map((r) => r.item_description.slice(0, 2000)),
      dimensions: EMBED_DIMS,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      scanned: rows.length,
      embedded: 0,
      failed: rows.length,
      errors: [`openai embeddings.create failed: ${msg.slice(0, 300)}`],
    }
  }

  if (response.data.length !== rows.length) {
    return {
      scanned: rows.length,
      embedded: 0,
      failed: rows.length,
      errors: [
        `length mismatch: requested ${rows.length}, got ${response.data.length}`,
      ],
    }
  }

  // Update each row with its embedding. Supabase doesn't have a great
  // bulk-update API for vector columns, so we do one update per row.
  // 50 small updates ≈ 50ms locally. Acceptable for a 15-minute cron.
  let embedded = 0
  let failed = 0
  const errors: string[] = []
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]
    const embedding = response.data[i].embedding
    if (!Array.isArray(embedding) || embedding.length !== EMBED_DIMS) {
      failed += 1
      errors.push(`row ${row.id}: bad embedding shape`)
      continue
    }
    // pgvector accepts the array as a JSON-stringified vector literal.
    const literal = `[${embedding.join(',')}]`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder = (admin.from as any)('market_data_points')
    const { error: updateErr } = await builder
      .update({ item_embedding: literal })
      .eq('id', row.id)
    if (updateErr) {
      failed += 1
      errors.push(`row ${row.id}: ${updateErr.message.slice(0, 150)}`)
    } else {
      embedded += 1
    }
  }

  return {
    scanned: rows.length,
    embedded,
    failed,
    errors: errors.slice(0, 10),
  }
}

/**
 * Embed a single query string for ad-hoc lookup. Returns the raw vector
 * as a pgvector-compatible string literal ("[0.1,0.2,...]"). Used by the
 * admin search action.
 */
export async function embedQueryString(query: string): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null
  const trimmed = query.trim().slice(0, 2000)
  if (trimmed.length === 0) return null

  const openai = new OpenAI({ apiKey })
  let response
  try {
    response = await openai.embeddings.create({
      model: EMBED_MODEL,
      input: trimmed,
      dimensions: EMBED_DIMS,
    })
  } catch {
    return null
  }
  const vec = response.data[0]?.embedding
  if (!Array.isArray(vec) || vec.length !== EMBED_DIMS) return null
  return `[${vec.join(',')}]`
}
