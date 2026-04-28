/**
 * Appraisal workflow state machine.
 *
 * Pure functions — no I/O. The detail-page server actions enforce these
 * transitions before issuing UPDATEs, and the UI hides illegal action buttons
 * based on canTransition() and the current status.
 *
 * Diagram:
 *
 *   draft ──────────► finalized ──────────► voided
 *      │                                       ▲
 *      └───────────────────────────────────────┘
 *
 *   draft → finalized requires: appraised_value > 0, appraiser_user_id set,
 *                               valid_from set.
 *   finalized → voided requires: void_reason non-empty.
 *   voided is terminal. Cannot revert finalized → draft.
 *
 * Print state interacts with the lock trigger in 0014: once finalized AND
 * is_printed, the DB rejects mutations to core fields. This module does not
 * model print state directly — the action layer flips is_printed=true on the
 * first /api/appraisals/[id]/pdf hit.
 */

import type { AppraisalStatus } from '@/types/database-aliases'

export const LEGAL_TRANSITIONS: Record<AppraisalStatus, AppraisalStatus[]> = {
  draft: ['finalized', 'voided'],
  finalized: ['voided'],
  voided: [],
}

export function canTransition(
  from: AppraisalStatus,
  to: AppraisalStatus,
): boolean {
  if (from === to) return false
  const allowed = LEGAL_TRANSITIONS[from]
  return allowed != null && allowed.indexOf(to) >= 0
}

export function isTerminal(status: AppraisalStatus): boolean {
  const allowed = LEGAL_TRANSITIONS[status]
  return !allowed || allowed.length === 0
}

/** Inputs required at finalize time. Field-level validation is in
 *  src/lib/validations/appraisal.ts; this guard runs immediately before
 *  the action issues the UPDATE so a partially-typed appraisal can't
 *  finalize accidentally. */
export type FinalizeReadinessInput = {
  appraised_value: number | null | undefined
  appraiser_user_id: string | null | undefined
  valid_from: string | null | undefined
  status: AppraisalStatus
}

export type FinalizeReadinessResult =
  | { ok: true }
  | { ok: false; reason: 'illegal_status' | 'missing_value' | 'missing_appraiser' | 'missing_valid_from' }

export function checkFinalizeReadiness(
  input: FinalizeReadinessInput,
): FinalizeReadinessResult {
  if (!canTransition(input.status, 'finalized'))
    return { ok: false, reason: 'illegal_status' }
  if (
    input.appraised_value == null ||
    !isFinite(Number(input.appraised_value)) ||
    Number(input.appraised_value) <= 0
  )
    return { ok: false, reason: 'missing_value' }
  if (!input.appraiser_user_id || input.appraiser_user_id.trim() === '')
    return { ok: false, reason: 'missing_appraiser' }
  if (!input.valid_from || !/^\d{4}-\d{2}-\d{2}$/.test(input.valid_from))
    return { ok: false, reason: 'missing_valid_from' }
  return { ok: true }
}
