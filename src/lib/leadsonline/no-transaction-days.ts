/**
 * Send LeadsOnline the days the shop had no transactions
 * (SetNoTransactionDayForStore, patches/0124) and keep each answer.
 *
 *   sendNoTransactionDays()  — the nightly job: every finished day since
 *                              Sol Pawn's first accepted ticket in this
 *                              environment with no pawn and no buy
 *                              (no-transaction-plan.ts).
 *   sendNoTransactionDay()   — one day by hand (Settings → LeadsOnline),
 *                              e.g. a day before Sol Pawn reported. Refused
 *                              for today, a future day, or a day with a pawn
 *                              or buy in Sol Pawn.
 *
 * "Day" is the shop's day (tenants.timezone). Days with tickets come from
 * compliance_log only (rule 15). Server only; callers check the role.
 */

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { dayStartInTimezone, todayInTimezone } from '@/lib/jurisdictions/rules'
import { addDaysIso } from '@/lib/pawn/math'
import { shopDateTime } from '@/lib/compliance/police-report/formats/fl-leadsonline-xml'
import { callLeadsOnline, loadLeadsOnlineConfig, type LeadsOnlineConfig } from './client'
import { parseResponse, setNoTransactionDayEnvelope, type LeadsOnlineEnv } from './soap'
import { NO_TRANSACTION_LOOKBACK_DAYS, planNoTransactionDays } from './no-transaction-plan'

type Admin = ReturnType<typeof createAdminClient>

export type NoTransactionDayResult = {
  day: string
  ok: boolean
  errorCode: number | null
  errorResponse: string
}

const INTAKES = ['pawn_intake', 'buy_outright']

async function shopTimezone(admin: Admin, tenantId: string): Promise<string> {
  const { data } = await admin.from('tenants').select('timezone').eq('id', tenantId).maybeSingle()
  return data?.timezone || 'America/New_York'
}

/** Shop days in [from, toExclusive) that have a pawn or a buy. */
async function ticketDays(admin: Admin, tenantId: string, from: string, toExclusive: string, tz: string): Promise<Set<string>> {
  const { data, error } = await admin
    .from('compliance_log')
    .select('occurred_at')
    .eq('tenant_id', tenantId)
    .in('event_type', INTAKES)
    .gte('occurred_at', dayStartInTimezone(from, tz))
    .lt('occurred_at', dayStartInTimezone(toExclusive, tz))
  if (error) throw new Error(`ticket_days_query_failed: ${error.message}`)
  return new Set((data ?? []).map((r) => shopDateTime(r.occurred_at, tz).slice(0, 10)))
}

async function sendOne(
  admin: Admin,
  tenantId: string,
  config: LeadsOnlineConfig,
  day: string,
  setBy: string | null,
): Promise<NoTransactionDayResult> {
  const call = await callLeadsOnline(config.env, 'SetNoTransactionDayForStore', setNoTransactionDayEnvelope(config.login, day))
  const answer = call.ok ? parseResponse(call.xml) : ({ kind: 'fault', message: call.message } as const)
  const ok = answer.kind === 'response' && answer.errorCode === 0
  const result: NoTransactionDayResult = {
    day,
    ok,
    errorCode: answer.kind === 'response' ? answer.errorCode : null,
    // On success LeadsOnline answers with the date it set; keep failures only.
    errorResponse: ok ? '' : (answer.kind === 'response' ? answer.errorResponse : answer.message).slice(0, 1000),
  }
  const { error } = await admin.from('leadsonline_no_transaction_days').insert({
    tenant_id: tenantId,
    environment: config.env,
    day,
    ok,
    error_code: result.errorCode,
    error_response: result.errorResponse || null,
    set_by: setBy,
  })
  // A unique violation = accepted already (two runs at once); not an error.
  if (error && error.code !== '23505') console.error('[leadsonline] no-transaction log insert failed', error.message)
  return result
}

/** The nightly job for one shop. */
export async function sendNoTransactionDays(tenantId: string): Promise<
  { ok: true; env: LeadsOnlineEnv; results: NoTransactionDayResult[] } | { ok: false; error: 'not_configured' }
> {
  const cfg = await loadLeadsOnlineConfig(tenantId)
  if (!cfg.ok) return { ok: false, error: 'not_configured' }
  const { config } = cfg
  const admin = createAdminClient()
  const tz = await shopTimezone(admin, tenantId)
  const today = todayInTimezone(tz)

  // The first day Sol Pawn reported: before it, another program may have.
  const { data: first } = await admin
    .from('leadsonline_submissions')
    .select('created_at')
    .eq('tenant_id', tenantId)
    .eq('environment', config.env)
    .eq('ok', true)
    .order('created_at', { ascending: true })
    .limit(1)
  const startDay = first?.[0] ? shopDateTime(first[0].created_at, tz).slice(0, 10) : null
  if (!startDay) return { ok: true, env: config.env, results: [] }

  const windowStart = addDaysIso(today, -NO_TRANSACTION_LOOKBACK_DAYS)
  const from = startDay > windowStart ? startDay : windowStart
  const [busy, { data: done }] = await Promise.all([
    ticketDays(admin, tenantId, from, today, tz),
    admin
      .from('leadsonline_no_transaction_days')
      .select('day')
      .eq('tenant_id', tenantId)
      .eq('environment', config.env)
      .eq('ok', true)
      .gte('day', from),
  ])
  const days = planNoTransactionDays({
    today,
    startDay,
    ticketDays: busy,
    doneDays: new Set((done ?? []).map((d) => d.day)),
  })

  const results: NoTransactionDayResult[] = []
  for (const day of days) results.push(await sendOne(admin, tenantId, config, day, null))
  return { ok: true, env: config.env, results }
}

/** One day by hand. */
export async function sendNoTransactionDay(args: { tenantId: string; userId: string; day: string }): Promise<
  | { ok: true; env: LeadsOnlineEnv; result: NoTransactionDayResult }
  | { ok: false; error: 'not_configured' | 'bad_day' | 'day_has_tickets' }
> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.day)) return { ok: false, error: 'bad_day' }
  const cfg = await loadLeadsOnlineConfig(args.tenantId)
  if (!cfg.ok) return { ok: false, error: 'not_configured' }
  const admin = createAdminClient()
  const tz = await shopTimezone(admin, args.tenantId)
  if (args.day >= todayInTimezone(tz)) return { ok: false, error: 'bad_day' }
  const busy = await ticketDays(admin, args.tenantId, args.day, addDaysIso(args.day, 1), tz)
  if (busy.size > 0) return { ok: false, error: 'day_has_tickets' }
  const result = await sendOne(admin, args.tenantId, cfg.config, args.day, args.userId)
  return { ok: true, env: cfg.config.env, result }
}
