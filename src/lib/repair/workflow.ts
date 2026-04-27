/**
 * Repair-ticket workflow state machine.
 *
 * Pure functions — no I/O. The detail-page server actions enforce these
 * transitions before issuing UPDATEs, and the UI hides illegal action buttons
 * based on canTransition() and the current status.
 *
 * Diagram:
 *
 *   intake ─────────────► quoted ──────────────► awaiting_approval
 *      │                    │                        │
 *      │                    └────► voided            │
 *      │                                             │
 *      └────► voided                                 ▼
 *                                              in_progress ◄────────┐
 *                                                  │                │
 *                                                  ├────► needs_parts
 *                                                  ├────► ready
 *                                                  ├────► voided
 *                                                  └────► abandoned
 *
 *   needs_parts ─► in_progress | voided | abandoned
 *   ready       ─► picked_up   | abandoned | voided
 *
 * picked_up / abandoned / voided are terminal.
 */

import type {
  RepairEventType,
  RepairStatus,
} from '@/types/database-aliases'

export const LEGAL_TRANSITIONS: Record<RepairStatus, RepairStatus[]> = {
  intake: ['quoted', 'voided'],
  quoted: ['awaiting_approval', 'voided'],
  awaiting_approval: ['in_progress', 'voided'],
  in_progress: ['needs_parts', 'ready', 'voided', 'abandoned'],
  needs_parts: ['in_progress', 'voided', 'abandoned'],
  ready: ['picked_up', 'abandoned', 'voided'],
  picked_up: [],
  abandoned: [],
  voided: [],
}

export function canTransition(
  from: RepairStatus,
  to: RepairStatus,
): boolean {
  if (from === to) return false
  const allowed = LEGAL_TRANSITIONS[from]
  return allowed != null && allowed.indexOf(to) >= 0
}

export function isTerminal(status: RepairStatus): boolean {
  const allowed = LEGAL_TRANSITIONS[status]
  return !allowed || allowed.length === 0
}

/**
 * Convenience helper used by the action layer to derive the next status from
 * an event_type. Returns null when the event doesn't imply a status change
 * (e.g. 'note', 'photo_added', 'paused', 'resumed').
 */
export function nextSuggestedStatus(
  currentStatus: RepairStatus,
  eventType: RepairEventType,
): RepairStatus | null {
  switch (eventType) {
    case 'intake':
      return 'intake'
    case 'quote_set':
      return canTransition(currentStatus, 'quoted') ? 'quoted' : null
    case 'approved':
      return canTransition(currentStatus, 'in_progress') ? 'in_progress' : null
    case 'started':
      return canTransition(currentStatus, 'in_progress') ? 'in_progress' : null
    case 'parts_needed':
      return canTransition(currentStatus, 'needs_parts') ? 'needs_parts' : null
    case 'parts_received':
      return canTransition(currentStatus, 'in_progress') ? 'in_progress' : null
    case 'completed':
      return canTransition(currentStatus, 'ready') ? 'ready' : null
    case 'pickup':
      return canTransition(currentStatus, 'picked_up') ? 'picked_up' : null
    case 'abandoned_conversion':
      return canTransition(currentStatus, 'abandoned') ? 'abandoned' : null
    case 'void':
      return canTransition(currentStatus, 'voided') ? 'voided' : null
    case 'paused':
    case 'resumed':
    case 'note':
    case 'photo_added':
      return null
  }
}
