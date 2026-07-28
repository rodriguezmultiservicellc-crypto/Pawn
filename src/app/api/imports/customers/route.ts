import { NextRequest, NextResponse } from 'next/server'
import { getCtx } from '@/lib/supabase/ctx'
import { logAudit } from '@/lib/audit'
import { parseCsv } from '@/lib/imports/csv'
import { autoGuessMapping, mapRows } from '@/lib/imports/engine'
import { getPreset } from '@/lib/imports/presets'
import type { ImportSourceId, Mapping } from '@/lib/imports/catalog'
import type { TenantRole } from '@/types/database-aliases'

/**
 * POST /api/imports/customers — bulk customer import (xPawn preset or a
 * generic column-mapped CSV). A Route Handler (not a server action) because
 * server-action bodies cap at ~1MB and real exports run several MB.
 *
 * Body: multipart form-data —
 *   source        'xpawn' | 'generic'
 *   mode          'preview' (default, writes nothing) | 'commit'
 *   file          the .csv
 *   mapping       (generic) JSON { targetField: sourceHeader }; auto-guessed if absent
 *   vendor_label  (generic) e.g. 'Bravo' → import_source slug
 *
 * Idempotent: rows carry legacy_ref = '<import_source>:<sourceId>'; already-
 * imported refs are skipped, so a re-run (or a resume after a timeout) is safe.
 */
export const runtime = 'nodejs'
export const maxDuration = 60

const ALLOWED = new Set<TenantRole>(['owner', 'manager', 'chain_admin'])
const MAX_BYTES = 25 * 1024 * 1024
const BATCH = 500

function bad(status: number, error: string) {
  return NextResponse.json({ error }, { status })
}
function slug(s: string): string {
  return (
    s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32) ||
    'generic'
  )
}

async function resolveRole(
  ctx: NonNullable<Awaited<ReturnType<typeof getCtx>>>,
): Promise<TenantRole | null> {
  if (ctx.tenantRole && ALLOWED.has(ctx.tenantRole)) return ctx.tenantRole
  // Chain-admin at the parent tenant counts for a child shop.
  const { data: t } = await ctx.supabase
    .from('tenants')
    .select('parent_tenant_id')
    .eq('id', ctx.tenantId as string)
    .maybeSingle()
  if (t?.parent_tenant_id) {
    const { data: ca } = await ctx.supabase
      .from('user_tenants')
      .select('role')
      .eq('user_id', ctx.userId)
      .eq('tenant_id', t.parent_tenant_id)
      .eq('role', 'chain_admin')
      .eq('is_active', true)
      .maybeSingle()
    if (ca?.role === 'chain_admin') return 'chain_admin'
  }
  return ctx.tenantRole ?? null
}

export async function POST(req: NextRequest) {
  const ctx = await getCtx()
  if (!ctx) return bad(401, 'Not signed in.')
  if (!ctx.tenantId) return bad(403, 'No active tenant.')

  const role = await resolveRole(ctx)
  if (!role || !ALLOWED.has(role)) return bad(403, 'Insufficient role to import.')

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return bad(400, 'Invalid multipart body.')
  }

  const source = String(form.get('source') ?? '') as ImportSourceId
  if (source !== 'xpawn' && source !== 'generic') return bad(400, 'Unknown source.')
  const mode = String(form.get('mode') ?? 'preview')

  const file = form.get('file')
  if (!(file instanceof Blob)) return bad(400, 'Missing CSV file.')
  if (file.size > MAX_BYTES) return bad(413, 'File too large (max 25MB).')

  const { headers, rows } = parseCsv(await file.text())
  if (headers.length === 0 || rows.length === 0) {
    return bad(400, 'CSV has no header + data rows.')
  }

  // Resolve mapping + source specials + import_source tag.
  let mapping: Mapping
  let warningHeader: string | undefined
  let skipTest: boolean | undefined
  let importSource: string
  if (source === 'xpawn') {
    const preset = getPreset('xpawn')!
    mapping = preset.mapping
    warningHeader = preset.warningHeader
    skipTest = preset.skipTest
    importSource = 'xpawn'
  } else {
    let provided: Mapping | null = null
    const rawMap = form.get('mapping')
    if (typeof rawMap === 'string' && rawMap.trim()) {
      try {
        provided = JSON.parse(rawMap) as Mapping
      } catch {
        return bad(400, 'Invalid mapping JSON.')
      }
    }
    mapping = provided ?? autoGuessMapping(headers)
    importSource = slug(String(form.get('vendor_label') ?? '').trim() || 'generic')
  }

  // Existing legacy_refs for this source (idempotency).
  const existingRefs = new Set<string>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await ctx.supabase
      .from('customers')
      .select('legacy_ref')
      .eq('tenant_id', ctx.tenantId)
      .eq('import_source', importSource)
      .not('legacy_ref', 'is', null)
      .range(from, from + 999)
    if (error) return bad(500, error.message)
    for (const r of data ?? []) if (r.legacy_ref) existingRefs.add(r.legacy_ref)
    if (!data || data.length < 1000) break
  }

  const { records, report, samples } = mapRows({
    rows,
    mapping,
    importSource,
    tenantId: ctx.tenantId,
    createdBy: ctx.userId,
    existingRefs,
    warningHeader,
    skipTest,
  })

  if (mode !== 'commit') {
    return NextResponse.json({ headers, mapping, importSource, report, samples })
  }

  let inserted = 0
  for (let i = 0; i < records.length; i += BATCH) {
    const chunk = records.slice(i, i + BATCH)
    const { error } = await ctx.supabase.from('customers').insert(chunk as never)
    if (error) {
      return NextResponse.json(
        { error: error.message, insertedBeforeError: inserted, report },
        { status: 500 },
      )
    }
    inserted += chunk.length
  }

  await logAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: 'create',
    tableName: 'customers',
    recordId: crypto.randomUUID(),
    changes: { kind: 'import', source: importSource, inserted, ...report },
  })

  return NextResponse.json({ report, inserted, importSource })
}
