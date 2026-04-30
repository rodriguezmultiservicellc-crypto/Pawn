/**
 * Pure-logic tests for the repair-ticket workflow state machine.
 *
 * The state machine backs every status transition the system performs —
 * board drag, detail-page buttons, tech inbox claims, cron-driven
 * abandons (when that lands). A regression here lets a ticket walk into
 * an illegal stage (no timer, no QA gate) or blocks a legal one (work
 * stalls). These tests pin down:
 *
 *   1. Every (from, to) pair the code path exercises is legal.
 *   2. Every illegal pair the UI might attempt is rejected.
 *   3. Self-transitions (drop on the same column, double-click on a
 *      button) are rejected so the audit log doesn't get noise rows.
 *   4. Terminal statuses have no exits.
 *   5. Auto-timer hooks fire only on in_progress entry/exit — every
 *      other status's hooks are no-ops.
 *   6. nextSuggestedStatus maps each event_type to the right next
 *      status given the current status, and returns null when the
 *      event doesn't imply a transition.
 */

import { describe, expect, it } from 'vitest'
import {
  LEGAL_TRANSITIONS,
  canTransition,
  isTerminal,
  nextSuggestedStatus,
  shouldOpenTimerOnEnter,
  shouldStopTimerOnLeave,
} from './workflow'
import type {
  RepairEventType,
  RepairStatus,
} from '@/types/database-aliases'

const ALL_STATUSES: ReadonlyArray<RepairStatus> = [
  'intake',
  'quoted',
  'awaiting_approval',
  'assigned',
  'in_progress',
  'needs_parts',
  'tech_qa',
  'ready',
  'picked_up',
  'abandoned',
  'voided',
]

const TERMINAL: ReadonlyArray<RepairStatus> = ['picked_up', 'abandoned', 'voided']

describe('canTransition — happy paths the buttoned actions take', () => {
  // Exhaustive list mirroring /repair/[id]/actions.ts: each row is one
  // (from, to) pair an action issues. Adding a new path? Add a row here
  // first; if this test fails the workflow needs an update before the
  // action can ship.
  const happy: ReadonlyArray<[RepairStatus, RepairStatus]> = [
    ['intake', 'quoted'],
    ['quoted', 'awaiting_approval'],
    ['awaiting_approval', 'assigned'],
    ['awaiting_approval', 'in_progress'],
    ['assigned', 'in_progress'],
    ['in_progress', 'needs_parts'],
    ['in_progress', 'tech_qa'],
    ['in_progress', 'ready'],
    ['needs_parts', 'in_progress'],
    ['tech_qa', 'ready'],
    ['tech_qa', 'in_progress'],
    ['ready', 'picked_up'],
    // Void / abandon legal from every active stage.
    ['intake', 'voided'],
    ['quoted', 'voided'],
    ['awaiting_approval', 'voided'],
    ['assigned', 'voided'],
    ['in_progress', 'voided'],
    ['needs_parts', 'voided'],
    ['tech_qa', 'voided'],
    ['ready', 'voided'],
    ['assigned', 'abandoned'],
    ['in_progress', 'abandoned'],
    ['needs_parts', 'abandoned'],
    ['tech_qa', 'abandoned'],
    ['ready', 'abandoned'],
  ]

  for (const [from, to] of happy) {
    it(`${from} → ${to}`, () => {
      expect(canTransition(from, to)).toBe(true)
    })
  }
})

describe('canTransition — illegal moves the kanban DnD must reject', () => {
  // Every (from, to) pair on the manager kanban that would let a card
  // skip a stage. The board's 5 active columns are
  // assigned/in_progress/needs_parts/tech_qa/ready, so anything that
  // shortcuts the workflow (assigned → ready, etc.) needs to fail.
  const illegal: ReadonlyArray<[RepairStatus, RepairStatus]> = [
    ['assigned', 'needs_parts'],
    ['assigned', 'tech_qa'],
    ['assigned', 'ready'],
    ['needs_parts', 'tech_qa'],
    ['needs_parts', 'ready'],
    // ready does NOT step backwards onto the board.
    ['ready', 'in_progress'],
    ['ready', 'needs_parts'],
    ['ready', 'tech_qa'],
    ['ready', 'assigned'],
    // Skipping intake / quote / approval gates.
    ['intake', 'in_progress'],
    ['quoted', 'in_progress'],
    ['quoted', 'assigned'],
    // Time-travel.
    ['in_progress', 'awaiting_approval'],
    ['in_progress', 'quoted'],
    ['in_progress', 'intake'],
  ]

  for (const [from, to] of illegal) {
    it(`${from} → ${to}`, () => {
      expect(canTransition(from, to)).toBe(false)
    })
  }
})

describe('canTransition — self transitions are rejected', () => {
  // Drop a card on its own column / double-click the same button:
  // both should be no-ops, not status writes.
  for (const status of ALL_STATUSES) {
    it(`${status} → ${status}`, () => {
      expect(canTransition(status, status)).toBe(false)
    })
  }
})

describe('canTransition — terminal statuses have zero exits', () => {
  for (const terminal of TERMINAL) {
    for (const to of ALL_STATUSES) {
      if (to === terminal) continue
      it(`${terminal} → ${to} is illegal`, () => {
        expect(canTransition(terminal, to)).toBe(false)
      })
    }
  }
})

describe('isTerminal', () => {
  it('returns true for picked_up / abandoned / voided', () => {
    expect(isTerminal('picked_up')).toBe(true)
    expect(isTerminal('abandoned')).toBe(true)
    expect(isTerminal('voided')).toBe(true)
  })

  it('returns false for every active stage', () => {
    const active: ReadonlyArray<RepairStatus> = [
      'intake',
      'quoted',
      'awaiting_approval',
      'assigned',
      'in_progress',
      'needs_parts',
      'tech_qa',
      'ready',
    ]
    for (const s of active) {
      expect(isTerminal(s)).toBe(false)
    }
  })
})

describe('LEGAL_TRANSITIONS table integrity', () => {
  it('lists every status as a key', () => {
    for (const s of ALL_STATUSES) {
      expect(LEGAL_TRANSITIONS).toHaveProperty(s)
    }
  })

  it('every value array references valid statuses only', () => {
    for (const [, targets] of Object.entries(LEGAL_TRANSITIONS)) {
      for (const t of targets) {
        expect(ALL_STATUSES.includes(t)).toBe(true)
      }
    }
  })

  it('no status maps to itself', () => {
    for (const [from, targets] of Object.entries(LEGAL_TRANSITIONS)) {
      expect(targets.includes(from as RepairStatus)).toBe(false)
    }
  })
})

describe('shouldOpenTimerOnEnter', () => {
  it('opens a timer only on entering in_progress', () => {
    expect(shouldOpenTimerOnEnter('in_progress')).toBe(true)
  })

  it('is a no-op for every other status', () => {
    for (const s of ALL_STATUSES) {
      if (s === 'in_progress') continue
      expect(shouldOpenTimerOnEnter(s)).toBe(false)
    }
  })
})

describe('shouldStopTimerOnLeave', () => {
  it('stops the timer only when leaving in_progress', () => {
    expect(shouldStopTimerOnLeave('in_progress')).toBe(true)
  })

  it('is a no-op for every other status', () => {
    for (const s of ALL_STATUSES) {
      if (s === 'in_progress') continue
      expect(shouldStopTimerOnLeave(s)).toBe(false)
    }
  })
})

describe('nextSuggestedStatus', () => {
  // Each row: (currentStatus, eventType) → expected next status.
  // null means the event_type doesn't imply a status change from that
  // current state, so the caller must NOT change status.
  const cases: ReadonlyArray<
    readonly [RepairStatus, RepairEventType, RepairStatus | null]
  > = [
    // Quote events
    ['intake', 'quote_set', 'quoted'],
    // already-quoted → no transition because canTransition('quoted','quoted')
    // is false (self).
    ['quoted', 'quote_set', null],
    // Approvals route to in_progress directly (legacy path) when
    // canTransition allows.
    ['awaiting_approval', 'approved', 'in_progress'],
    // started maps to in_progress when legal.
    ['needs_parts', 'started', 'in_progress'],
    // Parts cycle.
    ['in_progress', 'parts_needed', 'needs_parts'],
    ['needs_parts', 'parts_received', 'in_progress'],
    // Completion.
    ['in_progress', 'completed', 'ready'],
    // Pickup is only legal from ready.
    ['ready', 'pickup', 'picked_up'],
    ['in_progress', 'pickup', null],
    // Abandon / void from active stages.
    ['ready', 'abandoned_conversion', 'abandoned'],
    ['in_progress', 'void', 'voided'],
    ['intake', 'void', 'voided'],
    // Tech workflow.
    ['awaiting_approval', 'assigned_to_tech', 'assigned'],
    ['assigned', 'claimed_by_tech', 'in_progress'],
    ['in_progress', 'qa_started', 'tech_qa'],
    ['tech_qa', 'qa_completed', 'ready'],
    ['tech_qa', 'qa_returned', 'in_progress'],
    // Notes / photos / pause / resume never change status.
    ['in_progress', 'note', null],
    ['in_progress', 'photo_added', null],
    ['in_progress', 'paused', null],
    ['in_progress', 'resumed', null],
  ]

  for (const [current, event, expected] of cases) {
    it(`${current} + ${event} → ${expected ?? 'null'}`, () => {
      expect(nextSuggestedStatus(current, event)).toBe(expected)
    })
  }

  it('returns null when the event would force an illegal transition', () => {
    // Trying to claim from intake — legal next-status would be
    // in_progress, but intake → in_progress is illegal in the table.
    // The function should reflect the table, not the event_type.
    expect(nextSuggestedStatus('intake', 'claimed_by_tech')).toBe(null)
    // qa_completed from in_progress would land on ready, but the
    // workflow expects QA to flow tech_qa → ready, not in_progress →
    // ready via that event; in_progress → ready IS legal though, so
    // this returns 'ready'. Pin the actual behavior so anyone changing
    // it sees the regression.
    expect(nextSuggestedStatus('in_progress', 'qa_completed')).toBe('ready')
  })
})
