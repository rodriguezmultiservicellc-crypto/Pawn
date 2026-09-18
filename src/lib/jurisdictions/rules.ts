/**
 * Pure jurisdiction-rule helpers. Mirrors the SQL helpers in
 * patches/0048-jurisdictions.sql (jurisdiction_max_rate,
 * loan_forfeit_eligible_date, tenant_today) — the DB triggers are the
 * enforcement layer; these exist so the UI can explain a limit BEFORE the
 * operator hits it. Keep the two in lockstep (see rules.test.ts).
 */

import type { Json } from '@/types/database'

export type RateTier = { up_to: number | null; rate: number }

export type TicketNotice = { bold: boolean; en: string; es: string }

/** The subset of a `jurisdictions` row the app reasons about. */
export type Jurisdiction = {
  code: string
  name: string
  statute: string | null
  default_timezone: string
  rate_cap_monthly: number | null
  rate_tiers: RateTier[] | null
  period_days: number
  min_charge_cap: number | null
  min_term_days: number | null
  max_term_days: number | null
  grace_days: number
  grace_rolls_to_business_day: boolean
  buy_hold_days: number
  repair_abandon_days: number | null
  record_retention_years: number | null
  police_reporting_required: boolean
  ticket_notices: TicketNotice[]
  ticket_backpage: string | null
  verified_on: string | null
}

/** Tenant-level values after applying the statutory floors. */
export type EffectiveRules = {
  jurisdiction: Jurisdiction | null
  timezone: string
  graceDays: number
  buyHoldDays: number
  repairAbandonDays: number
  /** Null = no statutory retention on file. */
  retentionYears: number | null
}

export const DEFAULT_TIMEZONE = 'America/New_York'

// ── Parsing JSONB columns ──────────────────────────────────────────────────

export function parseRateTiers(v: Json | null): RateTier[] | null {
  if (!Array.isArray(v) || v.length === 0) return null
  const out: RateTier[] = []
  for (const t of v) {
    if (!t || typeof t !== 'object' || Array.isArray(t)) return null
    const rate = Number((t as Record<string, Json>).rate)
    const upRaw = (t as Record<string, Json>).up_to
    const up_to = upRaw == null || upRaw === '' ? null : Number(upRaw)
    if (!isFinite(rate) || (up_to != null && !isFinite(up_to))) return null
    out.push({ up_to, rate })
  }
  return out
}

export function parseTicketNotices(v: Json | null): TicketNotice[] {
  if (!Array.isArray(v)) return []
  const out: TicketNotice[] = []
  for (const n of v) {
    if (!n || typeof n !== 'object' || Array.isArray(n)) continue
    const r = n as Record<string, Json>
    const en = typeof r.en === 'string' ? r.en.trim() : ''
    if (!en) continue
    out.push({
      bold: r.bold === true,
      en,
      es: typeof r.es === 'string' ? r.es.trim() : '',
    })
  }
  return out
}

type JurisdictionRow = {
  code: string
  name: string
  statute: string | null
  default_timezone: string
  rate_cap_monthly: number | string | null
  rate_tiers: Json | null
  period_days: number
  min_charge_cap: number | string | null
  min_term_days: number | null
  max_term_days: number | null
  grace_days: number
  grace_rolls_to_business_day: boolean
  buy_hold_days: number
  repair_abandon_days: number | null
  record_retention_years: number | null
  police_reporting_required: boolean
  ticket_notices: Json
  ticket_backpage: string | null
  verified_on: string | null
}

const numOrNull = (v: number | string | null): number | null =>
  v == null ? null : Number(v)

export function toJurisdiction(row: JurisdictionRow): Jurisdiction {
  return {
    code: row.code,
    name: row.name,
    statute: row.statute,
    default_timezone: row.default_timezone,
    rate_cap_monthly: numOrNull(row.rate_cap_monthly),
    rate_tiers: parseRateTiers(row.rate_tiers),
    period_days: row.period_days,
    min_charge_cap: numOrNull(row.min_charge_cap),
    min_term_days: row.min_term_days,
    max_term_days: row.max_term_days,
    grace_days: row.grace_days,
    grace_rolls_to_business_day: row.grace_rolls_to_business_day,
    buy_hold_days: row.buy_hold_days,
    repair_abandon_days: row.repair_abandon_days,
    record_retention_years: row.record_retention_years,
    police_reporting_required: row.police_reporting_required,
    ticket_notices: parseTicketNotices(row.ticket_notices),
    ticket_backpage: row.ticket_backpage,
    verified_on: row.verified_on,
  }
}

// ── Rule math ──────────────────────────────────────────────────────────────

/**
 * Statutory cap (fraction per period) for a principal. Tiered caps are
 * blended across the principal's slices. Null principal = the cap for the
 * smallest loan (first tier). Null result = no cap on file.
 */
export function maxMonthlyRate(
  j: Pick<Jurisdiction, 'rate_cap_monthly' | 'rate_tiers'> | null,
  principal: number | null,
): number | null {
  if (!j) return null
  const tiers = j.rate_tiers
  if (!tiers || tiers.length === 0) return j.rate_cap_monthly
  if (principal == null || principal <= 0) return tiers[0].rate
  let lower = 0
  let charge = 0
  for (const t of tiers) {
    const upper = t.up_to
    const slice = Math.min(principal, upper ?? principal) - lower
    if (slice > 0) charge += slice * t.rate
    if (upper == null || upper >= principal) break
    lower = upper
  }
  return charge / principal
}

/** Rates are stored at 4dp; allow half a basis-point of float slack. */
export function exceedsCap(rate: number, cap: number | null): boolean {
  return cap != null && rate > cap + 0.00005
}

function isoToUtc(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function utcToIso(dt: Date): string {
  return dt.toISOString().slice(0, 10)
}

function addDays(iso: string, days: number): string {
  const dt = isoToUtc(iso)
  dt.setUTCDate(dt.getUTCDate() + days)
  return utcToIso(dt)
}

/** Last day the pledgor may redeem (due + grace, weekend-rolled if required). */
export function lastRedemptionDate(
  dueDate: string,
  graceDays: number,
  rollsToBusinessDay: boolean,
): string {
  let last = addDays(dueDate, graceDays)
  if (rollsToBusinessDay) {
    const dow = isoToUtc(last).getUTCDay() // 0 = Sun, 6 = Sat
    if (dow === 6) last = addDays(last, 2)
    else if (dow === 0) last = addDays(last, 1)
  }
  return last
}

/** First date the loan may be forfeited. */
export function forfeitEligibleDate(
  dueDate: string,
  graceDays: number,
  rollsToBusinessDay: boolean,
): string {
  return addDays(lastRedemptionDate(dueDate, graceDays, rollsToBusinessDay), 1)
}

/** Today's date (YYYY-MM-DD) in an IANA timezone. */
export function todayInTimezone(timezone: string, now: Date = new Date()): string {
  try {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now)
  } catch {
    return now.toISOString().slice(0, 10)
  }
}

export function effectiveRules(args: {
  jurisdiction: Jurisdiction | null
  timezone: string | null
  graceSetting: number | null
  buyHoldSetting: number | null
  repairAbandonSetting: number | null
}): EffectiveRules {
  const j = args.jurisdiction
  return {
    jurisdiction: j,
    timezone: args.timezone || j?.default_timezone || DEFAULT_TIMEZONE,
    graceDays: Math.max(args.graceSetting ?? 0, j?.grace_days ?? 0),
    buyHoldDays: Math.max(args.buyHoldSetting ?? 0, j?.buy_hold_days ?? 0),
    repairAbandonDays: Math.max(
      args.repairAbandonSetting ?? 0,
      j?.repair_abandon_days ?? 0,
    ),
    retentionYears: j?.record_retention_years ?? null,
  }
}

/** Forfeiture eligibility for a loan under a tenant's effective rules. */
export function loanForfeitEligibility(
  rules: EffectiveRules,
  dueDate: string,
  today: string = todayInTimezone(rules.timezone),
): { eligibleOn: string; eligible: boolean; lastRedemptionDate: string } {
  const rolls = rules.jurisdiction?.grace_rolls_to_business_day ?? false
  const last = lastRedemptionDate(dueDate, rules.graceDays, rolls)
  const eligibleOn = addDays(last, 1)
  return { eligibleOn, eligible: today >= eligibleOn, lastRedemptionDate: last }
}

/**
 * Map a DB trigger exception (patches/0048) to a stable error code the UI
 * can translate. Returns null when the message isn't a jurisdiction error.
 */
export function parseJurisdictionError(
  message: string | null | undefined,
): { code: string; value: string } | null {
  if (!message) return null
  const m =
    /(jurisdiction_rate_cap|jurisdiction_min_charge_cap|jurisdiction_term_min|jurisdiction_term_max|forfeit_not_eligible_until|buy_hold_active_until|buy_hold_cannot_shorten)(?::([^\s"]+))?/.exec(
      message,
    )
  return m ? { code: m[1], value: m[2] ?? '' } : null
}
