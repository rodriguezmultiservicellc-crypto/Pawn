import type { Dictionary } from '@/lib/i18n/en'
import { parseJurisdictionError } from './rules'

/**
 * Translate a jurisdiction-rule error code (from a server action or the DB
 * trigger message) into the user's language. Anything that isn't a rule
 * error is returned unchanged so existing raw-code displays keep working.
 */
export function ruleErrorText(t: Dictionary, raw: string): string {
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
