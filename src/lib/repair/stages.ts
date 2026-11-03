/**
 * Customer-facing repair stages — pure helpers shared by the staff UI
 * (board "Next stage" tap, ticket stage picker, settings editor) and the
 * public tracking page.
 *
 * The stage ↔ workflow-status sync itself lives in the database
 * (patches/0061 trigger repair_tickets_sync_public_stage) so every path
 * that changes status — twenty-odd actions plus the board — stays
 * coherent without each one remembering to call anything. What is here is
 * the arithmetic the UI needs around that pointer.
 */

import type { Language } from '@/lib/i18n/config'
import type { RepairStatus, ServiceType } from '@/types/database-aliases'

/** Every service type, in the order the settings editor shows them. */
export const SERVICE_TYPES: ReadonlyArray<ServiceType> = [
  'repair',
  'stone_setting',
  'sizing',
  'restring',
  'plating',
  'engraving',
  'custom',
]

/**
 * Statuses a stage may auto-advance on. 'voided' is excluded: a voided
 * ticket's tracking page is a not-found by design, so no stage can
 * represent it.
 */
export const MAPPABLE_STATUSES: ReadonlyArray<RepairStatus> = [
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
]

export type RepairStageLite = {
  id: string
  name_en: string
  name_es: string
  percent: number
  sort_order: number
}

/** Stage name in the viewer's language. */
export function stageName(stage: RepairStageLite, lang: Language): string {
  return lang === 'es' ? stage.name_es : stage.name_en
}

/** Stages sorted by sort_order (the DB returns them ordered; defensive). */
export function sortStages<T extends { sort_order: number }>(stages: ReadonlyArray<T>): T[] {
  return [...stages].sort((a, b) => a.sort_order - b.sort_order)
}

/** Index of the current stage in the ordered list, -1 when unset/unknown. */
export function stageIndex(
  stages: ReadonlyArray<RepairStageLite>,
  currentId: string | null | undefined,
): number {
  if (!currentId) return -1
  return sortStages(stages).findIndex((s) => s.id === currentId)
}

/** The stage after the current one, or null at the end / when unset. */
export function nextStage(
  stages: ReadonlyArray<RepairStageLite>,
  currentId: string | null | undefined,
): RepairStageLite | null {
  const ordered = sortStages(stages)
  if (ordered.length === 0) return null
  const idx = stageIndex(ordered, currentId)
  if (idx < 0) return ordered[0]
  return ordered[idx + 1] ?? null
}

/**
 * Progress-bar fill. The current stage's percent, or 0 when no stage is
 * set yet; clamped so a misconfigured stage can't overflow the bar.
 */
export function progressPercent(
  current: Pick<RepairStageLite, 'percent'> | null | undefined,
): number {
  if (!current) return 0
  return Math.min(100, Math.max(0, Math.round(current.percent)))
}

/** Public token shape: 32 lowercase hex chars (one UUID without dashes). */
export const PUBLIC_TOKEN_RE = /^[0-9a-f]{32}$/

export function isValidPublicToken(token: string | null | undefined): token is string {
  return typeof token === 'string' && PUBLIC_TOKEN_RE.test(token)
}

/** Absolute tracking URL for a token; null when the link is revoked. */
export function trackingUrl(
  token: string | null | undefined,
  appUrl: string | undefined = process.env.NEXT_PUBLIC_APP_URL,
): string | null {
  if (!isValidPublicToken(token)) return null
  const base = (appUrl ?? '').replace(/\/+$/, '')
  return `${base}/t/${token}`
}
