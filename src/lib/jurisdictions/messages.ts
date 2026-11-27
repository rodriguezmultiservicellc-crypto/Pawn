import type { Dictionary } from '@/lib/i18n/en'
import { parseJurisdictionError } from './rules'
import { parsePledgorIncomplete } from '@/lib/customers/pledgor-record'

const INTAKE_BLOCK_CODES = [
  'customer_banned',
  'ofac_review_required',
  'ofac_confirmed_match',
  'do_not_buy_match',
  'compliance_log_failed',
] as const

/**
 * Translate a rule / intake-block error code (from a server action or a DB
 * trigger message) into the user's language: jurisdiction limits
 * (patches/0048), repair abandonment, the intake gate (banned list + OFAC,
 * patches/0051), store credit (patches/0053) and the stale spot-price
 * guard. Anything else is returned unchanged so existing raw-code displays
 * keep working.
 */
export function ruleErrorText(t: Dictionary, raw: string): string {
  // The customer's record lacks what FL 539.001(8)(b) puts on the ticket.
  const missing = parsePledgorIncomplete(raw)
  if (missing) {
    return t.pledgorRecord.incomplete.replace(
      '{fields}',
      missing.map((f) => t.pledgorRecord.fields[f]).join(', '),
    )
  }

  // An item's photo list the server could not confirm (lib/uploads/intake-photos-server).
  if (raw === 'photos_missing') return t.common.photoStrip.missing

  // An item filled by voice the clerk has not checked (lib/pawn/intake-form).
  if (raw === 'items_unconfirmed') return t.pawn.new_.itemUnconfirmedError

  const block = INTAKE_BLOCK_CODES.find((c) => raw === c)
  if (block) return t.ofac.intakeErrors[block]

  const storeCredit = (t.storeCredit.errors as Record<string, string>)[raw]
  if (storeCredit) return storeCredit

  // Stale spot-price guard on buy / pawn intake (lib/spot-prices/stale-gate).
  const staleSpot = (t.spotPrices.errors as Record<string, string>)[raw]
  if (staleSpot) return staleSpot

  // Metal counter — mixed tenders, buyer, inventory (brief Phase 3).
  const counter = (t.buy.errors as Record<string, string>)[raw]
  if (counter) return counter

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
