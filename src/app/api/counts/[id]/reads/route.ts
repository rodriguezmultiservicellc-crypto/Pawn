/**
 * POST /api/counts/{id}/reads — record a batch of scanned codes.
 *
 * Body: { codes: string[] (1..500), source?: 'scanner' | 'rfid' | 'manual' }
 * Returns: { results: [{ code, outcome, description }], progress }
 *
 * One intake for every reader: the scan page posts each keyboard-scanner
 * read, and an RFID reader or companion app posts its batches to the same
 * place later. Gate: active tenant from getCtx(), count roles, session must
 * belong to the tenant and be open (checked again inside count_add_reads).
 * Reads are not audit-logged one by one: count_reads is itself the log
 * (who first read each code, when, how many times).
 */

import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { COUNT_ROLES, readBatchSchema } from '@/lib/counts/types'
import { loadCountProgress, loadCountSession, rpcAddReads } from '@/lib/counts/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: Request, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await props.params
  if (!UUID.test(id)) return Response.json({ error: 'count_not_found' }, { status: 404 })

  const ctx = await getCtx()
  if (!ctx) return Response.json({ error: 'unauthorized' }, { status: 401 })
  if (!ctx.tenantId) return Response.json({ error: 'no_tenant' }, { status: 403 })
  const tenantId = ctx.tenantId
  const { supabase, userId } = await requireRoleInTenant(tenantId, COUNT_ROLES)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'bad_json' }, { status: 400 })
  }
  const parsed = readBatchSchema.safeParse(body)
  if (!parsed.success) return Response.json({ error: 'bad_batch' }, { status: 400 })

  const session = await loadCountSession(supabase, tenantId, id)
  if (!session) return Response.json({ error: 'count_not_found' }, { status: 404 })
  if (session.status !== 'open') return Response.json({ error: 'count_not_open' }, { status: 409 })

  const r = await rpcAddReads({
    tenantId,
    userId,
    sessionId: id,
    codes: parsed.data.codes,
    source: parsed.data.source,
  })
  if (!r.ok) {
    const status = r.error === 'count_not_open' ? 409 : r.error === 'count_not_found' ? 404 : 400
    return Response.json({ error: r.error }, { status })
  }

  const progress = await loadCountProgress(supabase, tenantId, id)
  return Response.json({ results: r.data, progress }, { headers: { 'Cache-Control': 'no-store' } })
}
