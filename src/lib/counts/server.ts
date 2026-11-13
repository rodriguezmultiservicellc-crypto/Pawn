/**
 * Count sessions — server reads and the calls into the 0075 functions.
 *
 * Reads use the caller's (RLS) client. Writes go through the SECURITY
 * DEFINER functions, which only service_role may execute, so every caller
 * MUST guard with requireRoleInTenant() first and pass the guarded tenant.
 */

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  countErrorToken,
  type CountError,
  type CountKind,
  type CountProgress,
  type CountStatus,
  type ExceptionKind,
  type Finding,
  type ReadOutcome,
  type ReadResult,
  type ReadSource,
  type Resolution,
} from './types'

type Db = SupabaseClient<Database>
type Location = Database['public']['Enums']['inventory_location']
type Category = Database['public']['Enums']['inventory_category']

export type CountSession = {
  id: string
  tenant_id: string
  count_number: string
  kind: CountKind
  status: CountStatus
  scope_location: Location | null
  scope_shelf: string | null
  scope_category: Category | null
  transfer_id: string | null
  note: string | null
  expected_count: number | null
  seen_count: number | null
  missing_count: number | null
  unexpected_count: number | null
  left_count: number | null
  missing_value: number | null
  started_by: string | null
  started_at: string
  closed_by: string | null
  closed_at: string | null
  cancelled_at: string | null
}

const SESSION_COLS =
  'id, tenant_id, count_number, kind, status, scope_location, scope_shelf, scope_category, transfer_id, note, expected_count, seen_count, missing_count, unexpected_count, left_count, missing_value, started_by, started_at, closed_by, closed_at, cancelled_at'

function toSession(r: Record<string, unknown>): CountSession {
  const num = (v: unknown) => (v == null ? null : Number(v))
  return {
    ...(r as unknown as CountSession),
    expected_count: num(r.expected_count),
    seen_count: num(r.seen_count),
    missing_count: num(r.missing_count),
    unexpected_count: num(r.unexpected_count),
    left_count: num(r.left_count),
    missing_value: num(r.missing_value),
  }
}

export async function loadCountSession(supabase: Db, tenantId: string, id: string): Promise<CountSession | null> {
  const { data } = await supabase
    .from('count_sessions')
    .select(SESSION_COLS)
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  return data ? toSession(data) : null
}

export async function listCountSessions(
  supabase: Db,
  tenantIds: string[],
  opts: { limit?: number; status?: CountStatus; closedFrom?: string; closedToExclusive?: string } = {},
): Promise<CountSession[]> {
  if (tenantIds.length === 0) return []
  let q = supabase
    .from('count_sessions')
    .select(SESSION_COLS)
    .in('tenant_id', tenantIds)
    .is('deleted_at', null)
    .order('started_at', { ascending: false })
    .limit(opts.limit ?? 100)
  if (opts.status) q = q.eq('status', opts.status)
  if (opts.closedFrom) q = q.gte('closed_at', opts.closedFrom)
  if (opts.closedToExclusive) q = q.lt('closed_at', opts.closedToExclusive)
  const { data } = await q
  return (data ?? []).map(toSession)
}

/** Live progress: expected total, distinct expected seen, codes read that were not expected. */
export async function loadCountProgress(supabase: Db, tenantId: string, sessionId: string): Promise<CountProgress> {
  const [expected, seenRows, extra] = await Promise.all([
    supabase.from('count_expected').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).eq('session_id', sessionId),
    supabase.from('count_reads').select('expected_id')
      .eq('tenant_id', tenantId).eq('session_id', sessionId).not('expected_id', 'is', null),
    supabase.from('count_reads').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).eq('session_id', sessionId).is('expected_id', null),
  ])
  const seen = new Set((seenRows.data ?? []).map((r) => r.expected_id)).size
  return { expected: expected.count ?? 0, seen, extra: extra.count ?? 0 }
}

export type ExpectedRow = {
  id: string
  code: string
  description: string | null
  inventory_item_id: string | null
  collateral_item_id: string | null
  loan_id: string | null
  seen: boolean
}

/** The expected list with a seen flag, for the "not yet seen" panel. */
export async function loadExpected(supabase: Db, tenantId: string, sessionId: string): Promise<ExpectedRow[]> {
  const [exp, reads] = await Promise.all([
    supabase.from('count_expected')
      .select('id, code, description, inventory_item_id, collateral_item_id, loan_id')
      .eq('tenant_id', tenantId).eq('session_id', sessionId)
      .order('code', { ascending: true })
      .limit(5000),
    supabase.from('count_reads').select('expected_id')
      .eq('tenant_id', tenantId).eq('session_id', sessionId).not('expected_id', 'is', null)
      .limit(5000),
  ])
  const seen = new Set((reads.data ?? []).map((r) => r.expected_id))
  return (exp.data ?? []).map((e) => ({ ...e, seen: seen.has(e.id) }))
}

export type RecentRead = { code: string; outcome: ReadOutcome; description: string | null; at: string }

export async function loadRecentReads(supabase: Db, tenantId: string, sessionId: string, limit = 25): Promise<RecentRead[]> {
  const { data } = await supabase
    .from('count_reads')
    .select('code, expected_id, inventory_item_id, collateral_item_id, first_seen_at, count_expected(description), inventory_items(description), loan_collateral_items(description)')
    .eq('tenant_id', tenantId)
    .eq('session_id', sessionId)
    .order('first_seen_at', { ascending: false })
    .limit(limit)
  return (data ?? []).map((r) => ({
    code: r.code,
    outcome: r.expected_id ? 'expected' : r.inventory_item_id || r.collateral_item_id ? 'unexpected' : 'unknown',
    description:
      r.count_expected?.description ?? r.inventory_items?.description ?? r.loan_collateral_items?.description ?? null,
    at: r.first_seen_at,
  }))
}

export type StoredException = {
  id: string
  kind: ExceptionKind
  reason: string | null
  code: string | null
  inventory_item_id: string | null
  collateral_item_id: string | null
  loan_id: string | null
  description: string | null
  value: number
  close_note: string | null
  resolution: Resolution | null
  resolution_note: string | null
  resolved_at: string | null
}

export async function loadExceptions(supabase: Db, tenantId: string, sessionId: string): Promise<StoredException[]> {
  const { data } = await supabase
    .from('count_exceptions')
    .select('id, kind, reason, code, inventory_item_id, collateral_item_id, loan_id, description, value, close_note, resolution, resolution_note, resolved_at')
    .eq('tenant_id', tenantId)
    .eq('session_id', sessionId)
    .limit(5000)
  return (data ?? []).map((r) => ({
    ...(r as unknown as StoredException),
    value: Number(r.value ?? 0),
  }))
}

export type PledgeAlert = { count: number; sessionId: string | null }

/**
 * Unresolved missing pledged items across these shops (the manager alert),
 * and the most recent count that has one, to link to.
 */
export async function loadPledgeAlert(supabase: Db, tenantIds: string[]): Promise<PledgeAlert> {
  if (tenantIds.length === 0) return { count: 0, sessionId: null }
  const { data, count } = await supabase
    .from('count_exceptions')
    .select('session_id', { count: 'exact' })
    .in('tenant_id', tenantIds)
    .eq('kind', 'missing_pledge')
    .is('resolution', null)
    .order('created_at', { ascending: false })
    .limit(1)
  return { count: count ?? 0, sessionId: data?.[0]?.session_id ?? null }
}

// ── Writes (service_role functions; guard first) ──────────────────────────

type Ok<T> = { ok: true; data: T } | { ok: false; error: CountError }

export async function rpcStartCount(args: {
  tenantId: string
  userId: string
  kind: CountKind
  location?: Location | null
  shelf?: string | null
  category?: Category | null
  transferId?: string | null
  note?: string | null
}): Promise<Ok<string>> {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('count_start', {
    p_tenant_id: args.tenantId,
    p_user_id: args.userId,
    p_kind: args.kind,
    p_location: args.location ?? undefined,
    p_shelf: args.shelf ?? undefined,
    p_category: args.category ?? undefined,
    p_transfer_id: args.transferId ?? undefined,
    p_note: args.note ?? undefined,
  })
  if (error || !data) {
    console.error('[counts.start]', error?.message)
    return { ok: false, error: countErrorToken(error?.message) }
  }
  return { ok: true, data: data as string }
}

export async function rpcAddReads(args: {
  tenantId: string
  userId: string
  sessionId: string
  codes: string[]
  source: ReadSource
}): Promise<Ok<ReadResult[]>> {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('count_add_reads', {
    p_tenant_id: args.tenantId,
    p_session_id: args.sessionId,
    p_user_id: args.userId,
    p_codes: args.codes,
    p_source: args.source,
  })
  if (error) {
    console.error('[counts.reads]', error.message)
    return { ok: false, error: countErrorToken(error.message) }
  }
  return {
    ok: true,
    data: (data ?? []).map((r) => ({
      code: r.o_code,
      outcome: r.o_outcome as ReadOutcome,
      description: r.o_description,
    })),
  }
}

/** Findings so far. The session must already be verified to belong to the guarded tenant. */
export async function rpcFindings(sessionId: string): Promise<Finding[]> {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('count_findings', { p_session_id: sessionId })
  if (error) {
    console.error('[counts.findings]', error.message)
    return []
  }
  return (data ?? []).map((r) => ({
    kind: r.o_kind as ExceptionKind,
    reason: r.o_reason,
    code: r.o_code,
    inventoryItemId: r.o_inventory_item_id,
    collateralItemId: r.o_collateral_item_id,
    loanId: r.o_loan_id,
    description: r.o_description,
    value: Number(r.o_value ?? 0),
  }))
}

export async function rpcCloseCount(args: {
  tenantId: string
  userId: string
  sessionId: string
  notes: Record<string, string>
}): Promise<Ok<{ missing: number; unexpected: number; left: number }>> {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('count_close', {
    p_tenant_id: args.tenantId,
    p_session_id: args.sessionId,
    p_user_id: args.userId,
    p_notes: args.notes,
  })
  if (error) {
    console.error('[counts.close]', error.message)
    return { ok: false, error: countErrorToken(error.message) }
  }
  const row = (data ?? [])[0]
  return {
    ok: true,
    data: { missing: row?.o_missing ?? 0, unexpected: row?.o_unexpected ?? 0, left: row?.o_left ?? 0 },
  }
}

export async function rpcCancelCount(args: { tenantId: string; userId: string; sessionId: string }): Promise<Ok<null>> {
  const admin = createAdminClient()
  const { error } = await admin.rpc('count_cancel', {
    p_tenant_id: args.tenantId,
    p_session_id: args.sessionId,
    p_user_id: args.userId,
  })
  if (error) {
    console.error('[counts.cancel]', error.message)
    return { ok: false, error: countErrorToken(error.message) }
  }
  return { ok: true, data: null }
}

export async function rpcResolveException(args: {
  tenantId: string
  userId: string
  exceptionId: string
  resolution: Resolution
  note: string | null
}): Promise<Ok<null>> {
  const admin = createAdminClient()
  const { error } = await admin.rpc('count_resolve_exception', {
    p_tenant_id: args.tenantId,
    p_exception_id: args.exceptionId,
    p_user_id: args.userId,
    p_resolution: args.resolution,
    p_note: args.note ?? undefined,
  })
  if (error) {
    console.error('[counts.resolve]', error.message)
    return { ok: false, error: countErrorToken(error.message) }
  }
  return { ok: true, data: null }
}
