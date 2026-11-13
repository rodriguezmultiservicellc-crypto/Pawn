/**
 * Counts and shrinkage report — per shop, rolled up at chain HQ.
 *
 * In range = closed in range (counts, missing) or resolved in range
 * (write-offs). Open pledge alerts are current, not ranged: an unresolved
 * missing pledged item stays on the report until someone resolves it.
 */

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { reportBounds } from '@/lib/reports/range'
import type { ReportRange } from '@/lib/reports/types'
import { listCountSessions, type CountSession } from './server'

type Db = SupabaseClient<Database>

export type ShrinkageRow = {
  tenantId: string
  shopName: string
  counts: number
  missingItems: number
  missingValue: number
  writtenOffValue: number
  openPledges: number
}

export type CountsReport = {
  rows: ShrinkageRow[]
  totals: Omit<ShrinkageRow, 'tenantId' | 'shopName'>
  sessions: Array<CountSession & { shopName: string }>
}

/** Range dates are in the shop's timezone (shopReportRange / parseRange). */
export async function loadCountsReport(args: {
  supabase: Db
  tenantIds: string[]
  range: ReportRange
}): Promise<CountsReport> {
  const { supabase, tenantIds, range } = args
  const { fromIso, toExclusiveIso } = reportBounds(range)
  const empty = { counts: 0, missingItems: 0, missingValue: 0, writtenOffValue: 0, openPledges: 0 }
  if (tenantIds.length === 0) return { rows: [], totals: empty, sessions: [] }

  const [tenants, inRange, writeOffs, pledges] = await Promise.all([
    supabase.from('tenants').select('id, name, dba').in('id', tenantIds),
    listCountSessions(supabase, tenantIds, {
      limit: 2000,
      status: 'closed',
      closedFrom: fromIso,
      closedToExclusive: toExclusiveIso,
    }),
    supabase
      .from('count_exceptions')
      .select('tenant_id, value')
      .in('tenant_id', tenantIds)
      .eq('resolution', 'written_off')
      .gte('resolved_at', fromIso)
      .lt('resolved_at', toExclusiveIso)
      .limit(10000),
    supabase
      .from('count_exceptions')
      .select('tenant_id')
      .in('tenant_id', tenantIds)
      .eq('kind', 'missing_pledge')
      .is('resolution', null)
      .limit(10000),
  ])

  const names = new Map((tenants.data ?? []).map((t) => [t.id, t.dba?.trim() || t.name]))
  const byTenant = new Map<string, ShrinkageRow>()
  for (const id of tenantIds) {
    byTenant.set(id, { tenantId: id, shopName: names.get(id) ?? id.slice(0, 8), ...empty })
  }
  for (const s of inRange) {
    const row = byTenant.get(s.tenant_id)
    if (!row) continue
    row.counts += 1
    row.missingItems += s.missing_count ?? 0
    row.missingValue += s.missing_value ?? 0
  }
  for (const w of writeOffs.data ?? []) {
    const row = byTenant.get(w.tenant_id)
    if (row) row.writtenOffValue += Number(w.value ?? 0)
  }
  for (const p of pledges.data ?? []) {
    const row = byTenant.get(p.tenant_id)
    if (row) row.openPledges += 1
  }

  const rows = [...byTenant.values()].sort((a, b) => a.shopName.localeCompare(b.shopName))
  const totals = rows.reduce(
    (acc, r) => ({
      counts: acc.counts + r.counts,
      missingItems: acc.missingItems + r.missingItems,
      missingValue: acc.missingValue + r.missingValue,
      writtenOffValue: acc.writtenOffValue + r.writtenOffValue,
      openPledges: acc.openPledges + r.openPledges,
    }),
    empty,
  )
  return {
    rows,
    totals,
    sessions: inRange.map((s) => ({ ...s, shopName: names.get(s.tenant_id) ?? '' })),
  }
}
