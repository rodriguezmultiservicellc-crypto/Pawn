import { isLaserOrderStatus, isOpenLaserStatus, type LaserOrderStatus } from './status'

/**
 * Pure status-merge for laser orders. The webhook, the poller and the
 * Cancel action all funnel a remote observation through `mergeRemoteStatus`
 * so the row changes the same way no matter who saw the change first.
 *
 * Ordering rule: a remote observation only counts when it is NEWER than the
 * last one we applied (`remote_updated_at`). A poll that returns the same
 * snapshot twice, or a webhook retry, changes nothing; a stale poll that
 * lands after a fresher webhook is ignored. `cut` is the one status that
 * legitimately repeats, so a newer `cut` on an already-cut order bumps the
 * count instead of being dropped.
 */

export type CutDetails = {
  width_mm?: number
  height_mm?: number
  minutes?: number
  passes?: number
}

export type HistoryVia = 'webhook' | 'poll' | 'app'

export type HistoryEntry = {
  status: LaserOrderStatus
  /** When it happened (remote time when known). */
  at: string
  via: HistoryVia
  /** OroCut machine nickname, Sol Pawn user id, or null. */
  by?: string | null
  reason?: string | null
}

export type RemoteObservation = {
  status: LaserOrderStatus
  /** ISO time of the change as the remote reports it. */
  at: string
  by?: string | null
  reason?: string | null
  details?: CutDetails | null
}

export type LocalStatusRow = {
  status: LaserOrderStatus
  remote_updated_at: string | null
  cut_count: number
  cut_details: unknown
  status_history: unknown
}

export type LaserStatusPatch = {
  status?: LaserOrderStatus
  status_history?: HistoryEntry[]
  cut_count?: number
  cut_details?: CutDetails | null
  reject_reason?: string | null
  finished_at?: string | null
  remote_updated_at?: string
  last_synced_at: string
  last_sync_error: null
}

export type MergeResult =
  | { changed: false; patch: LaserStatusPatch }
  | { changed: true; from: LaserOrderStatus; to: LaserOrderStatus; patch: LaserStatusPatch }

export function parseHistory(v: unknown): HistoryEntry[] {
  if (!Array.isArray(v)) return []
  const out: HistoryEntry[] = []
  for (const e of v) {
    if (!e || typeof e !== 'object') continue
    const o = e as Record<string, unknown>
    if (!isLaserOrderStatus(o.status) || typeof o.at !== 'string') continue
    const via: HistoryVia =
      o.via === 'webhook' || o.via === 'poll' || o.via === 'app' ? o.via : 'poll'
    out.push({
      status: o.status,
      at: o.at,
      via,
      by: typeof o.by === 'string' ? o.by : null,
      reason: typeof o.reason === 'string' ? o.reason : null,
    })
  }
  return out
}

export function parseCutDetails(v: unknown): CutDetails | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const num = (k: string) => (typeof o[k] === 'number' && Number.isFinite(o[k]) ? (o[k] as number) : undefined)
  const d: CutDetails = {
    width_mm: num('width_mm'),
    height_mm: num('height_mm'),
    minutes: num('minutes'),
    passes: num('passes'),
  }
  return Object.values(d).some((x) => x !== undefined) ? d : null
}

function isoOrNow(s: string | undefined, now: string): string {
  if (!s) return now
  const t = Date.parse(s)
  return Number.isNaN(t) ? now : new Date(t).toISOString()
}

export function mergeRemoteStatus(
  row: LocalStatusRow,
  remote: RemoteObservation,
  via: HistoryVia,
  now: string = new Date().toISOString(),
): MergeResult {
  const base: LaserStatusPatch = { last_synced_at: now, last_sync_error: null }

  // Final is final — the DB trigger refuses too; don't even try.
  if (!isOpenLaserStatus(row.status)) return { changed: false, patch: base }

  const remoteAt = isoOrNow(remote.at, now)
  if (row.remote_updated_at) {
    const last = Date.parse(row.remote_updated_at)
    if (!Number.isNaN(last) && Date.parse(remoteAt) <= last) {
      return { changed: false, patch: base }
    }
  }

  // Same status seen again with a newer stamp: only `cut` means something.
  if (remote.status === row.status && remote.status !== 'cut') {
    return { changed: false, patch: { ...base, remote_updated_at: remoteAt } }
  }

  const history = parseHistory(row.status_history)
  history.push({
    status: remote.status,
    at: remoteAt,
    via,
    by: remote.by ?? null,
    reason: remote.reason ?? null,
  })

  const patch: LaserStatusPatch = {
    ...base,
    status: remote.status,
    status_history: history,
    remote_updated_at: remoteAt,
  }
  if (remote.status === 'cut') {
    patch.cut_count = row.cut_count + 1
    patch.cut_details = remote.details ?? parseCutDetails(row.cut_details)
  }
  if (remote.status === 'rejected') {
    patch.reject_reason = remote.reason ?? null
  }
  if (!isOpenLaserStatus(remote.status)) {
    patch.finished_at = remoteAt
  }
  return { changed: true, from: row.status, to: remote.status, patch }
}
