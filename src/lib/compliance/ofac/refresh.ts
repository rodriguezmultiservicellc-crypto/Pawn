/**
 * Download + load the OFAC SDN list (patches/0051). Called by the daily
 * /api/cron/refresh-ofac. Content-addressed: an unchanged feed (same
 * SHA-256) is a no-op; a new one is loaded as a fresh version and then
 * activated atomically (ofac_activate_version), keeping one prior version.
 */

import 'server-only'
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { parseCsvGrid } from '@/lib/imports/csv'
import { parseSdnFeed } from './match'

const SLS = 'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports'
const SDN_URL = `${SLS}/SDN.CSV`
const ALT_URL = `${SLS}/ALT.CSV`
const INSERT_BATCH = 1000
/** The published list carries thousands of individuals; far fewer means a bad download. */
const MIN_EXPECTED_NAMES = 5000

export type RefreshResult =
  | { status: 'unchanged'; versionId: string }
  | { status: 'loaded'; versionId: string; individuals: number; names: number; publishedOn: string | null }

async function download(url: string): Promise<{ text: string; finalUrl: string }> {
  const res = await fetch(url, { redirect: 'follow', cache: 'no-store' })
  if (!res.ok) throw new Error(`ofac_download_failed:${res.status}:${url}`)
  return { text: await res.text(), finalUrl: res.url }
}

export async function refreshOfacList(
  admin: SupabaseClient<Database>,
): Promise<RefreshResult> {
  const [sdn, alt] = await Promise.all([download(SDN_URL), download(ALT_URL)])
  const sha = createHash('sha256').update(sdn.text).update('\n--ALT--\n').update(alt.text).digest('hex')

  const { data: existing } = await admin
    .from('ofac_list_versions')
    .select('id, is_current')
    .eq('source_sha256', sha)
    .maybeSingle()
  if (existing) {
    if (!existing.is_current) {
      const { error } = await admin.rpc('ofac_activate_version', { p_version_id: existing.id })
      if (error) throw new Error(`ofac_activate_failed:${error.message}`)
    }
    return { status: 'unchanged', versionId: existing.id }
  }

  const rows = parseSdnFeed(parseCsvGrid(sdn.text), parseCsvGrid(alt.text))
  if (rows.length < MIN_EXPECTED_NAMES) {
    throw new Error(`ofac_feed_too_small:${rows.length}`)
  }
  const individuals = new Set(rows.map((r) => r.ent_num)).size
  // The feed redirects to a dated S3 path: .../Published/<id>/YYYY-MM-DD/...
  const publishedOn = /\/(\d{4}-\d{2}-\d{2})\//.exec(sdn.finalUrl)?.[1] ?? null

  const { data: version, error: vErr } = await admin
    .from('ofac_list_versions')
    .insert({
      source_sha256: sha,
      published_on: publishedOn,
      individual_count: individuals,
      name_count: rows.length,
      is_current: false,
    })
    .select('id')
    .single()
  if (vErr || !version) throw new Error(`ofac_version_insert_failed:${vErr?.message}`)

  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const { error } = await admin.from('ofac_sdn_names').insert(
      rows.slice(i, i + INSERT_BATCH).map((r) => ({ version_id: version.id, ...r })),
    )
    if (error) {
      await admin.from('ofac_list_versions').delete().eq('id', version.id)
      throw new Error(`ofac_names_insert_failed:${error.message}`)
    }
  }

  const { error: actErr } = await admin.rpc('ofac_activate_version', { p_version_id: version.id })
  if (actErr) throw new Error(`ofac_activate_failed:${actErr.message}`)

  return { status: 'loaded', versionId: version.id, individuals, names: rows.length, publishedOn }
}
