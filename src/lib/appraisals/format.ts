/**
 * Display-format helpers for appraisals. Mirrors the small formatting
 * utilities in src/lib/repair/billing and src/lib/portal/format — kept
 * deliberately minimal so the bulk of the math lives in src/lib/pawn/math.
 */

import type {
  AppraisalPurpose,
  AppraisalStatus,
} from '@/types/database-aliases'

export function appraisalNumberLabel(num: string | null | undefined): string {
  if (!num) return '—'
  return num
}

/** USD currency, 2dp display. Matches PawnTicketPDF.formatMoney. */
export function formatAppraisalMoney(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '—'
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function purposeIsInsurance(p: AppraisalPurpose): boolean {
  return p === 'insurance'
}

/** Pretty-print an ISO date or null. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return iso
}

/** Status label keys (resolved client-side via i18n). The action /
 *  detail layers pass the literal status string to the i18n lookup. */
export const STATUS_KEYS: ReadonlyArray<AppraisalStatus> = [
  'draft',
  'finalized',
  'voided',
]

export const PURPOSE_KEYS: ReadonlyArray<AppraisalPurpose> = [
  'insurance',
  'estate',
  'sale',
  'pawn_intake',
  'collateral_review',
  'customer_request',
]
