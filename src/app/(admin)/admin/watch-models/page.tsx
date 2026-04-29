import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { createAdminClient } from '@/lib/supabase/admin'
import WatchModelsContent, { type WatchModelRow } from './content'

/**
 * /admin/watch-models — superadmin curation surface for the watch
 * reference table. v1 is platform-level (no tenant scoping); every
 * shop sees the same catalog when the typeahead pings the read API.
 */
export default async function AdminWatchModelsPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (ctx.globalRole !== 'superadmin') redirect('/no-tenant')

  const admin = createAdminClient()
  const { data: rows } = await admin
    .from('watch_models')
    .select(
      'id, brand, model, reference_no, nickname, year_start, year_end, est_value_min, est_value_max, notes, created_at, updated_at',
    )
    .is('deleted_at', null)
    .order('brand')
    .order('model')

  // NUMERIC columns come back as string per generated types; the runtime
  // coerces. Narrow at the boundary.
  const items: WatchModelRow[] = (rows ?? []).map((r) => ({
    id: r.id,
    brand: r.brand,
    model: r.model,
    reference_no: r.reference_no,
    nickname: r.nickname,
    year_start: r.year_start,
    year_end: r.year_end,
    est_value_min: Number(r.est_value_min),
    est_value_max: Number(r.est_value_max),
    notes: r.notes,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }))

  return <WatchModelsContent rows={items} />
}
