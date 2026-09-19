import type { Dictionary } from '@/lib/i18n/en'
import { parseJurisdictionError } from './rules'

const INTAKE_BLOCK_CODES = [
  'customer_banned',
  'ofac_review_required',
  'ofac_confirmed_match',
  'compliance_log_failed',
] as const

/**
 * Translate a rule / intake-block error code (from a server action or a DB
 * trigger message) into the user's language: jurisdiction limits
 * (patches/0048), repair abandonment, and the intake gate (banned list +
 * OFAC, patches/0051). Anything else is returned unchanged so existing
 * raw-code displays keep working.
 */
export function ruleErrorText(t: Dictionary, raw: string): string {
  const block = INTAKE_BLOCK_CODES.find((c) => raw === c)
  if (block) return t.ofac.intakeErrors[block]

  const parsed = parseJurisdictionError(raw) ?? parseRepairAbandon(raw)
  if (!parsed) return raw
  const m = t.jurisdiction.errors
  const value =
    parsed.code === 'jurisdiction_rate_cap'
      ? `${(Number(parsed.value) * 100).toFixed(2)}%`
      : parsed.code === 'jurisdiction_min_charge_cap'
      ? `$${Number(parsed.value).toFixed(2)}`
      : parsed.value
  const template = m[parsed.code as keyof typeof m] ?? raw
  return template.replace('{value}', value)
}

function parseRepairAbandon(raw: string): { code: string; value: string } | null {
  const m = /repair_abandon_not_eligible_until:(\S+)/.exec(raw)
  return m ? { code: 'repair_abandon_not_eligible_until', value: m[1] } : null
}
