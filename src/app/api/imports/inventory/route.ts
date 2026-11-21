import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/supabase/ctx'
import { logAudit } from '@/lib/audit'
import { parseCsv } from '@/lib/imports/csv'
import { resolveImportRole } from '@/lib/imports/access'
import {
  LIGHTSPEED_SOURCE,
  checkLightspeedHeaders,
  mapLightspeedRows,
} from '@/lib/imports/lightspeed'
import { todayInTimezone } from '@/lib/jurisdictions/rules'
import { loadTenantRules } from '@/lib/jurisdictions/load'

/**
 * POST /api/imports/inventory — Lightspeed Retail (X-Series) product export
 * → inventory_items, one row per unit on hand. A Route Handler (not a
 * server action) because server-action bodies cap at ~1MB and a real
 * export with HTML descriptions runs well past that.
 *
 * Body: multipart form-data —
 *   mode    'preview' (default, writes nothing) | 'commit'
 *   file    the product-export .csv
 *   outlet  which outlet's stock to import (required when the file has
 *           more than one inventory_<outlet> column)
 *
 * Idempotent: every unit carries import_ref '<product id>#<n>' (unique per
 * tenant + source, patches/0089); refs already imported are skipped, so a
 * re-run or a resume after a timeout never doubles a piece.
 *
 * Errors come back as { error: <code> } so the page can translate them.
 */
export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_BYTES = 25 * 1024 * 1024
const BATCH = 500

function fail(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status })
}

export async function POST(req: NextRequest) {
  const ctx = await getCtx()
  if (!ctx) return fail(401, 'not_signed_in')
  if (!ctx.tenantId) return fail(403, 'no_tenant')
  if (!(await resolveImportRole(ctx))) return fail(403, 'not_authorized')
  const tenantId = ctx.tenantId

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return fail(400, 'bad_body')
  }
  const mode = String(form.get('mode') ?? 'preview')
  const file = form.get('file')
  if (!(file instanceof Blob)) return fail(400, 'no_file')
  if (file.size > MAX_BYTES) return fail(413, 'too_large')

  const { headers, rows } = parseCsv(await file.text())
  if (headers.length === 0 || rows.length === 0) return fail(400, 'empty_file')

  const check = checkLightspeedHeaders(headers)
  if (!check.ok) return fail(400, 'not_lightspeed', { missing: check.missing })

  const requested = String(form.get('outlet') ?? '').trim()
  const outlet = requested || (check.outlets.length === 1 ? check.outlets[0] : '')
  if (!outlet) return fail(400, 'pick_outlet', { outlets: check.outlets })
  if (!check.outlets.includes(outlet)) return fail(400, 'unknown_outlet', { outlets: check.outlets })

  const [{ data: tenant }, rules] = await Promise.all([
    ctx.supabase.from('tenants').select('public_slug').eq('id', tenantId).maybeSingle(),
    loadTenantRules(ctx.supabase, tenantId),
  ])

  // Units already imported for this tenant (idempotency).
  const existingRefs = new Set<string>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await ctx.supabase
      .from('inventory_items')
      .select('import_ref')
      .eq('tenant_id', tenantId)
      .eq('import_source', LIGHTSPEED_SOURCE)
      .not('import_ref', 'is', null)
      .range(from, from + 999)
    if (error) {
      console.error('[imports.inventory] load refs', error.message)
      return fail(500, 'load_failed')
    }
    for (const r of data ?? []) if (r.import_ref) existingRefs.add(r.import_ref)
    if (!data || data.length < 1000) break
  }

  const { records, report, samples } = mapLightspeedRows({
    rows,
    outlet,
    tenantId,
    createdBy: ctx.userId,
    acquiredAt: todayInTimezone(rules.timezone),
    existingRefs,
  })

  if (mode !== 'commit') {
    return NextResponse.json({ outlet, outlets: check.outlets, report, samples })
  }

  let inserted = 0
  let failure: string | null = null
  for (let i = 0; i < records.length; i += BATCH) {
    const chunk = records.slice(i, i + BATCH)
    const { error } = await ctx.supabase.from('inventory_items').insert(chunk)
    if (error) {
      console.error('[imports.inventory] insert', error.message)
      failure = error.message
      break
    }
    inserted += chunk.length
  }

  if (inserted > 0) {
    await logAudit({
      tenantId,
      userId: ctx.userId,
      action: 'create',
      tableName: 'inventory_items',
      recordId: crypto.randomUUID(),
      changes: {
        kind: 'import',
        source: LIGHTSPEED_SOURCE,
        outlet,
        file_name: file instanceof File ? file.name : null,
        inserted,
        failed: failure != null,
        ...report,
      },
    })
    revalidatePath('/inventory')
    if (tenant?.public_slug) revalidatePath(`/s/${tenant.public_slug}/catalog`)
  }

  if (failure) {
    // Re-running picks up where this stopped (refs make it idempotent).
    return fail(500, 'insert_failed', { inserted, report })
  }
  return NextResponse.json({ inserted, report })
}
