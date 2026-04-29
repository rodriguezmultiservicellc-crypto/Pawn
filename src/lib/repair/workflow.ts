/**
 * Repair-ticket workflow state machine.
 *
 * Pure functions — no I/O. The detail-page server actions enforce these
 * transitions before issuing UPDATEs, and the UI hides illegal action buttons
 * based on canTransition() and the current status.
 *
 * Diagram:
 *
 *   intake ─► quoted ─► awaiting_approval ─► assigned ─► in_progress ◄──────┐
 *      │        │              │                ▲             │             │
 *      │        │              │                │             ├─► needs_parts
 *      │        │              │                │             │             │
 *      │        │              │                │             ├─► tech_qa ──┘
 *      │        │              │                │             │       │
 *      │        │              └─► (legacy ─────┴───────────► )       ▼
 *      │        │                  in_progress)                    ready ─► picked_up
 *      │        └─► voided                                            │
 *      └─► voided                                                     ├─► abandoned
 *                                                                     └─► voided
 *
 *   tech_qa ─► ready | in_progress (returned) | voided | abandoned
 *   needs_parts ─► in_progress | voided | abandoned
 *   ready       ─► picked_up   | abandoned | voided
 *
 * Auto-timer hooks (enforced in actions, not here):
 *   - Entering in_progress (via claim / parts_received / qa_returned) opens
 *     a repair_time_logs row for the assigned tech.
 *   - Leaving in_progress (to needs_parts / tech_qa / ready / voided /
 *     abandoned) stops the running timer.
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
  // awaiting_approval can route through assigned (preferred) or jump
  // straight to in_progress for the legacy operator-does-it-all path.
  awaiting_approval: ['assigned', 'in_progress', 'voided'],
  assigned: ['in_progress', 'voided', 'abandoned'],
  in_progress: ['needs_parts', 'tech_qa', 'ready', 'voided', 'abandoned'],
  needs_parts: ['in_progress', 'voided', 'abandoned'],
  tech_qa: ['ready', 'in_progress', 'voided', 'abandoned'],
  ready: ['picked_up', 'abandoned', 'voided'],
  picked_up: [],
  abandoned: [],
  voided: [],
}

/**
 * True when entering this status should open a fresh repair_time_logs
 * row for the active technician. Currently only in_progress.
 */
export function shouldOpenTimerOnEnter(status: RepairStatus): boolean {
  return status === 'in_progress'
}

/**
 * True when leaving this status should stop the running repair_time_logs
 * row. Currently only in_progress (every other status implies the tech
 * isn't actively working).
 */
export function shouldStopTimerOnLeave(status: RepairStatus): boolean {
  return status === 'in_progress'
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
    case 'assigned_to_tech':
      return canTransition(currentStatus, 'assigned') ? 'assigned' : null
    case 'claimed_by_tech':
      return canTransition(currentStatus, 'in_progress') ? 'in_progress' : null
    case 'qa_started':
      return canTransition(currentStatus, 'tech_qa') ? 'tech_qa' : null
    case 'qa_completed':
      return canTransition(currentStatus, 'ready') ? 'ready' : null
    case 'qa_returned':
      return canTransition(currentStatus, 'in_progress') ? 'in_progress' : null
    case 'paused':
    case 'resumed':
    case 'note':
    case 'photo_added':
      return null
  }
}
