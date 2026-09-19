/**
 * OFAC screening service (patches/0051). Server-only; callers guard first
 * (requireRoleInTenant) and pass the service-role client.
 *
 * screenCustomer()  — run a fresh screening against the current list and
 *                     record it. A potential match whose blocking SDN
 *                     entries were all already cleared for the same name +
 *                     DOB is carried forward as cleared (no re-review on
 *                     every list update).
 * intakeGate()      — the pawn / buy intake check: banned customers and
 *                     unresolved or confirmed OFAC matches are refused.
 *                     Reuses the latest screening when it ran against the
 *                     current list for the same name + DOB.
 */

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'
import { evaluateCandidates, normalizeForIndex, type OfacMatch } from './match'

type Admin = SupabaseClient<Database>

export type ScreeningContext = 'customer_create' | 'pawn_intake' | 'buy_intake' | 'manual'

export type ScreeningRow = {
  id: string
  result: 'clear' | 'potential_match' | 'unavailable'
  review_status: 'not_required' | 'pending' | 'cleared' | 'confirmed'
  list_version_id: string | null
  screened_name: string
  screened_dob: string | null
}

const SCREENING_COLUMNS =
  'id, result, review_status, list_version_id, screened_name, screened_dob'

type CustomerIdentity = {
  first_name: string
  middle_name: string | null
  last_name: string
  date_of_birth: string | null
}

function displayName(c: CustomerIdentity): string {
  return [c.first_name, c.middle_name, c.last_name].filter(Boolean).join(' ').trim()
}

async function loadCustomer(
  admin: Admin,
  tenantId: string,
  customerId: string,
): Promise<(CustomerIdentity & { is_banned: boolean }) | null> {
  const { data } = await admin
    .from('customers')
    .select('first_name, middle_name, last_name, date_of_birth, is_banned')
    .eq('id', customerId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle()
  return data
}

async function currentVersion(
  admin: Admin,
): Promise<{ id: string; fetched_at: string } | null> {
  const { data } = await admin
    .from('ofac_list_versions')
    .select('id, fetched_at')
    .eq('is_current', true)
    .maybeSingle()
  return data
}

function blockingEntNums(matches: ReadonlyArray<OfacMatch>): number[] {
  return matches.filter((m) => !m.dob_conflict).map((m) => m.ent_num)
}

export async function screenCustomer(args: {
  admin: Admin
  tenantId: string
  customerId: string
  context: ScreeningContext
  userId: string | null
}): Promise<ScreeningRow> {
  const { admin, tenantId, customerId, context, userId } = args
  const customer = await loadCustomer(admin, tenantId, customerId)
  if (!customer) throw new Error('customer_not_found')

  const name = displayName(customer)
  const version = await currentVersion(admin)

  let result: ScreeningRow['result'] = 'unavailable'
  let matches: OfacMatch[] = []
  let topScore = 0
  if (version) {
    const query = normalizeForIndex(name)
    const { data: candidates, error } = query
      ? await admin.rpc('ofac_candidates', { p_query: query, p_limit: 200 })
      : { data: [], error: null }
    if (error) throw new Error(`ofac_candidates_failed:${error.message}`)
    const evaluation = evaluateCandidates(
      {
        firstName: customer.first_name,
        middleName: customer.middle_name,
        lastName: customer.last_name,
        dob: customer.date_of_birth,
      },
      candidates ?? [],
    )
    result = evaluation.result
    matches = evaluation.matches
    topScore = evaluation.topScore
  }

  let reviewStatus: ScreeningRow['review_status'] =
    result === 'potential_match' ? 'pending' : 'not_required'
  let carriedFrom: string | null = null
  if (result === 'potential_match') {
    // Carry forward a prior clearance covering the same SDN entries.
    const { data: cleared } = await admin
      .from('ofac_screenings')
      .select('id, matches')
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId)
      .eq('review_status', 'cleared')
      .eq('screened_name', name)
      .order('created_at', { ascending: false })
      .limit(1)
    const prior = cleared?.[0]
    if (prior) {
      const clearedEnts = new Set(
        blockingEntNums((prior.matches as unknown as OfacMatch[]) ?? []),
      )
      if (blockingEntNums(matches).every((e) => clearedEnts.has(e))) {
        reviewStatus = 'cleared'
        carriedFrom = prior.id
      }
    }
  }

  const { data: row, error: insErr } = await admin
    .from('ofac_screenings')
    .insert({
      tenant_id: tenantId,
      customer_id: customerId,
      list_version_id: version?.id ?? null,
      list_fetched_at: version?.fetched_at ?? null,
      screened_name: name,
      screened_dob: customer.date_of_birth,
      context,
      result,
      matches: matches as unknown as Json,
      top_score: topScore,
      review_status: reviewStatus,
      review_note: carriedFrom ? 'carried_forward' : null,
      carried_from: carriedFrom,
      created_by: userId,
    })
    .select(SCREENING_COLUMNS)
    .single()
  if (insErr || !row) throw new Error(`ofac_screening_insert_failed:${insErr?.message}`)
  return row as ScreeningRow
}

export type IntakeGateResult =
  | { ok: true; screeningId: string | null }
  | { ok: false; code: 'customer_banned' | 'ofac_review_required' | 'ofac_confirmed_match' }

/** Pawn / buy intake check. Call after the role guard. */
export async function intakeGate(args: {
  admin: Admin
  tenantId: string
  customerId: string
  context: 'pawn_intake' | 'buy_intake'
  userId: string
}): Promise<IntakeGateResult> {
  const { admin, tenantId, customerId } = args
  const customer = await loadCustomer(admin, tenantId, customerId)
  if (!customer) return { ok: true, screeningId: null } // caller reports not-found
  if (customer.is_banned) return { ok: false, code: 'customer_banned' }

  const { data: settings } = await admin
    .from('settings')
    .select('ofac_screening_enabled')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (settings && settings.ofac_screening_enabled === false) {
    return { ok: true, screeningId: null }
  }

  const version = await currentVersion(admin)
  const { data: latestRows } = await admin
    .from('ofac_screenings')
    .select(SCREENING_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(1)
  const latest = (latestRows?.[0] as ScreeningRow | undefined) ?? null

  const reusable =
    latest &&
    latest.result !== 'unavailable' &&
    version != null &&
    latest.list_version_id === version.id &&
    latest.screened_name === displayName(customer) &&
    (latest.screened_dob ?? null) === (customer.date_of_birth ?? null)

  const screening = reusable ? latest : await screenCustomer({ ...args, context: args.context })

  if (screening.review_status === 'pending') return { ok: false, code: 'ofac_review_required' }
  if (screening.review_status === 'confirmed') return { ok: false, code: 'ofac_confirmed_match' }
  return { ok: true, screeningId: screening.id }
}
