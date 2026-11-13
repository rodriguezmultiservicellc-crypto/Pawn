/**
 * Display helpers for count sessions. Pure; pass the active dictionary.
 */

import type { Dictionary } from '@/lib/i18n/en'
import { categoryLabel, locationLabel } from '@/lib/inventory/labels'
import type { CountSession } from '@/lib/counts/server'
import type { ReadOutcome, Severity } from '@/lib/counts/types'

export function countScopeLabel(
  s: Pick<CountSession, 'kind' | 'scope_location' | 'scope_shelf' | 'scope_category'>,
  t: Dictionary,
): string {
  if (s.kind === 'vault') return t.counts.scope.vault
  if (s.kind === 'transfer') return t.counts.scope.transfer
  const parts: string[] = []
  if (s.scope_location) parts.push(locationLabel(s.scope_location, t))
  if (s.scope_shelf) parts.push(t.counts.scope.shelf.replace('{shelf}', s.scope_shelf))
  parts.push(s.scope_category ? categoryLabel(s.scope_category, t) : t.counts.start.anyCategory)
  return parts.join(' · ')
}

export function reasonLabel(reason: string | null, t: Dictionary): string | null {
  if (!reason) return null
  const map = t.counts.reasons as Record<string, string>
  return map[reason] ?? reason
}

export const SEVERITY_TONE: Record<Severity, string> = {
  danger: 'border-danger/30 bg-danger/5 text-danger',
  warning: 'border-warning/30 bg-warning/5 text-warning',
  info: 'border-info/30 bg-info/5 text-info',
}

export const OUTCOME_TONE: Record<ReadOutcome, string> = {
  expected: 'border-success/30 bg-success/10 text-success',
  repeat: 'border-border bg-background text-muted',
  unexpected: 'border-warning/30 bg-warning/10 text-warning',
  unknown: 'border-danger/30 bg-danger/10 text-danger',
}

export const STATUS_TONE = {
  open: 'border-warning/30 bg-warning/10 text-warning',
  closed: 'border-success/30 bg-success/10 text-success',
  cancelled: 'border-border bg-background text-muted',
} as const
