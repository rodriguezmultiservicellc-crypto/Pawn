/**
 * Count sessions (patches/0075, PLAN-2026-11-13 Phase 2a). Pure.
 *
 * A count compares the expected snapshot taken at start with the codes
 * scanned. Every write is a SECURITY DEFINER function in the database;
 * this file holds the shared vocabulary, the input schemas and the
 * mapping from database error tokens to translation keys.
 */

import { z } from 'zod'
import type { TenantRole } from '@/types/database-aliases'
import { inventoryCategorySchema, inventoryLocationSchema } from '@/lib/validations/inventory'

export const COUNT_KINDS = ['case', 'vault', 'transfer'] as const
export type CountKind = (typeof COUNT_KINDS)[number]

export const COUNT_STATUSES = ['open', 'closed', 'cancelled'] as const
export type CountStatus = (typeof COUNT_STATUSES)[number]

export const EXCEPTION_KINDS = [
  'missing_pledge',
  'missing',
  'held_in_sales',
  'unexpected',
  'left_during_count',
] as const
export type ExceptionKind = (typeof EXCEPTION_KINDS)[number]

export const EXCEPTION_REASONS = [
  'unknown_code',
  'not_on_transfer',
  'not_in_stock',
  'not_in_scope',
  'other_location',
  'other_status',
  'added_after_start',
  'loan_closed',
  'pledged_item',
] as const
export type ExceptionReason = (typeof EXCEPTION_REASONS)[number]

export const READ_OUTCOMES = ['expected', 'repeat', 'unexpected', 'unknown'] as const
export type ReadOutcome = (typeof READ_OUTCOMES)[number]

export const RESOLUTIONS = ['found', 'written_off', 'explained'] as const
export type Resolution = (typeof RESOLUTIONS)[number]

export const READ_SOURCES = ['scanner', 'rfid', 'manual'] as const
export type ReadSource = (typeof READ_SOURCES)[number]

/** Who can start, scan, close and cancel a count. */
export const COUNT_ROLES: readonly TenantRole[] = ['owner', 'chain_admin', 'manager', 'pawn_clerk']
/** Who can resolve exceptions (write off, mark found). */
export const COUNT_RESOLVE_ROLES: readonly TenantRole[] = ['owner', 'chain_admin', 'manager']

/** Same cap as the database function. */
export const MAX_READ_BATCH = 500

export const startCountSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('case'),
    location: inventoryLocationSchema,
    shelf: z.string().trim().max(60).optional().transform((s) => (s ? s : null)),
    category: z
      .union([inventoryCategorySchema, z.literal('')])
      .optional()
      .transform((c) => (c ? c : null)),
    note: z.string().trim().max(500).optional(),
  }),
  z.object({ kind: z.literal('vault'), note: z.string().trim().max(500).optional() }),
  z.object({ kind: z.literal('transfer'), transferId: z.uuid(), note: z.string().trim().max(500).optional() }),
])
export type StartCountInput = z.input<typeof startCountSchema>

export const readBatchSchema = z.object({
  codes: z.array(z.string().max(200)).min(1).max(MAX_READ_BATCH),
  source: z.enum(READ_SOURCES).default('scanner'),
})

export const resolveExceptionSchema = z.object({
  exceptionId: z.uuid(),
  resolution: z.enum(RESOLUTIONS),
  note: z.string().trim().max(500).optional(),
})

export type ReadResult = { code: string; outcome: ReadOutcome; description: string | null }

export type CountProgress = { expected: number; seen: number; extra: number }

export type Finding = {
  kind: ExceptionKind
  reason: string | null
  code: string | null
  inventoryItemId: string | null
  collateralItemId: string | null
  loanId: string | null
  description: string | null
  value: number
}

export type Severity = 'danger' | 'warning' | 'info'

/** How loud an exception is on screen. A missing pledge is the loudest thing in the app. */
export function exceptionSeverity(kind: ExceptionKind, reason: string | null): Severity {
  if (kind === 'missing_pledge') return 'danger'
  if (reason === 'loan_closed' || reason === 'pledged_item') return 'danger'
  if (kind === 'missing' || kind === 'held_in_sales' || reason === 'not_in_stock') return 'warning'
  return 'info'
}

/** Findings sorted the way the close screen shows them: worst first. */
export function sortFindings<T extends { kind: ExceptionKind; reason: string | null; code: string | null }>(rows: T[]): T[] {
  const rank: Record<Severity, number> = { danger: 0, warning: 1, info: 2 }
  return [...rows].sort((a, b) => {
    const s = rank[exceptionSeverity(a.kind, a.reason)] - rank[exceptionSeverity(b.kind, b.reason)]
    if (s !== 0) return s
    const k = EXCEPTION_KINDS.indexOf(a.kind) - EXCEPTION_KINDS.indexOf(b.kind)
    if (k !== 0) return k
    return (a.code ?? '').localeCompare(b.code ?? '')
  })
}

/** Error tokens raised by the 0075 functions, plus the app's own. */
export const COUNT_ERRORS = [
  'count_module_off',
  'count_location_required',
  'count_transfer_not_found',
  'count_transfer_closed',
  'count_bad_kind',
  'count_not_found',
  'count_not_open',
  'count_batch_too_large',
  'count_pledge_note_required',
  'count_bad_resolution',
  'count_exception_not_found',
  'count_exception_resolved',
  'count_note_required',
  'count_failed',
] as const
export type CountError = (typeof COUNT_ERRORS)[number]

/** Map a Postgres error message to a known token. */
export function countErrorToken(message: string | null | undefined): CountError {
  const m = message ?? ''
  return COUNT_ERRORS.find((t) => t !== 'count_failed' && m.includes(t)) ?? 'count_failed'
}
