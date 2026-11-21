/**
 * GET /api/spot/strip — the dashboard "Live metals" numbers, for the widget's
 * auto-refresh (components/dashboard/useLiveMetals.ts).
 *
 * Read-only. Spot prices are platform-wide; the only tenant data is the
 * shop's display percent, read through the user client (RLS applies).
 * Gate: signed-in staff at the active tenant. Not audited (a read).
 */

import { getCtx } from '@/lib/supabase/ctx'
import { requireStaff } from '@/lib/supabase/guards'
import { loadDisplayPct, loadMetalsStrip } from '@/lib/spot-prices/strip'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(): Promise<Response> {
  const ctx = await getCtx()
  if (!ctx) return Response.json({ error: 'unauthorized' }, { status: 401 })
  if (!ctx.tenantId) return Response.json({ error: 'no_tenant' }, { status: 403 })
  const { supabase } = await requireStaff(ctx.tenantId)

  const data = await loadMetalsStrip(await loadDisplayPct(supabase, ctx.tenantId))
  return Response.json(data, { headers: { 'Cache-Control': 'private, no-store' } })
}
