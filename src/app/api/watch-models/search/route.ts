import { NextResponse, type NextRequest } from 'next/server'
import { getCtx } from '@/lib/supabase/ctx'

/**
 * GET /api/watch-models/search?q=<query>&limit=<n>
 *
 * Authenticated read-only typeahead for the watch_models reference
 * table. Returns up to `limit` matches across brand / model /
 * reference_no / nickname. Tenant-scoped staff role required (the
 * UI surface is /pawn/new which is already staff-gated).
 *
 * Result shape is small on purpose — the typeahead only needs label
 * + range. Detail panel in the calculator can fetch the full row by
 * id later if/when we surface notes.
 */
export async function GET(req: NextRequest) {
  const ctx = await getCtx()
  if (!ctx) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  if (!ctx.tenantRole) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase()
  const limit = Math.min(
    50,
    Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10) || 20),
  )
  if (q.length < 1) {
    return NextResponse.json({ items: [] })
  }

  // Use the user-scoped client — RLS allows authenticated users to read
  // watch_models per migration 0020. No service-role bypass needed.
  // Use ilike across brand/model/reference_no/nickname; OR them
  // together via the .or() helper.
  const pattern = `%${q}%`
  const { data, error } = await ctx.supabase
    .from('watch_models')
    .select(
      'id, brand, model, reference_no, nickname, year_start, year_end, est_value_min, est_value_max',
    )
    .is('deleted_at', null)
    .or(
      [
        `brand.ilike.${pattern}`,
        `model.ilike.${pattern}`,
        `reference_no.ilike.${pattern}`,
        `nickname.ilike.${pattern}`,
      ].join(','),
    )
    .order('brand')
    .order('model')
    .limit(limit)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // NUMERIC columns come back as string per generated types; coerce.
  const items = (data ?? []).map((r) => ({
    id: r.id,
    brand: r.brand,
    model: r.model,
    reference_no: r.reference_no,
    nickname: r.nickname,
    year_start: r.year_start,
    year_end: r.year_end,
    est_value_min: Number(r.est_value_min),
    est_value_max: Number(r.est_value_max),
  }))

  return NextResponse.json({ items })
}
