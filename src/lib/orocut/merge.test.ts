import { describe, expect, it } from 'vitest'
import { mergeRemoteStatus, parseCutDetails, parseHistory, type LocalStatusRow } from './merge'

const NOW = '2026-11-09T15:00:00.000Z'

function row(over: Partial<LocalStatusRow> = {}): LocalStatusRow {
  return {
    status: 'new',
    remote_updated_at: null,
    cut_count: 0,
    cut_details: null,
    status_history: [{ status: 'new', at: '2026-11-09T14:00:00.000Z', via: 'app', by: 'u1' }],
    ...over,
  }
}

describe('mergeRemoteStatus', () => {
  it('moves new → received and appends to the history', () => {
    const r = mergeRemoteStatus(row(), { status: 'received', at: '2026-11-09T14:05:00Z', by: 'Laser-1' }, 'webhook', NOW)
    expect(r.changed).toBe(true)
    if (!r.changed) return
    expect(r.from).toBe('new')
    expect(r.to).toBe('received')
    expect(r.patch.status).toBe('received')
    expect(r.patch.remote_updated_at).toBe('2026-11-09T14:05:00.000Z')
    expect(r.patch.status_history).toHaveLength(2)
    expect(r.patch.status_history?.[1]).toMatchObject({ status: 'received', via: 'webhook', by: 'Laser-1' })
    expect(r.patch.finished_at).toBeUndefined()
    expect(r.patch.last_synced_at).toBe(NOW)
  })

  it('ignores an observation that is not newer than the last applied one', () => {
    const r = mergeRemoteStatus(
      row({ status: 'received', remote_updated_at: '2026-11-09T14:05:00.000Z' }),
      { status: 'new', at: '2026-11-09T14:04:00Z' },
      'poll',
      NOW,
    )
    expect(r.changed).toBe(false)
    expect(r.patch).toEqual({ last_synced_at: NOW, last_sync_error: null })
  })

  it('a webhook retry (same stamp) changes nothing', () => {
    const r = mergeRemoteStatus(
      row({ status: 'received', remote_updated_at: '2026-11-09T14:05:00.000Z' }),
      { status: 'received', at: '2026-11-09T14:05:00Z' },
      'webhook',
      NOW,
    )
    expect(r.changed).toBe(false)
  })

  it('a newer poll with the same status only advances the remote stamp', () => {
    const r = mergeRemoteStatus(
      row({ status: 'received', remote_updated_at: '2026-11-09T14:05:00.000Z' }),
      { status: 'received', at: '2026-11-09T14:10:00Z' },
      'poll',
      NOW,
    )
    expect(r.changed).toBe(false)
    expect(r.patch.remote_updated_at).toBe('2026-11-09T14:10:00.000Z')
  })

  it('counts every newer cut and keeps the latest details', () => {
    const first = mergeRemoteStatus(
      row({ status: 'received', remote_updated_at: '2026-11-09T14:05:00.000Z' }),
      { status: 'cut', at: '2026-11-09T14:20:00Z', details: { width_mm: 31.2, height_mm: 8, minutes: 3, passes: 2 } },
      'webhook',
      NOW,
    )
    expect(first.changed).toBe(true)
    expect(first.patch.cut_count).toBe(1)
    expect(first.patch.cut_details).toEqual({ width_mm: 31.2, height_mm: 8, minutes: 3, passes: 2 })

    const second = mergeRemoteStatus(
      row({
        status: 'cut',
        remote_updated_at: '2026-11-09T14:20:00.000Z',
        cut_count: 1,
        cut_details: { width_mm: 31.2, height_mm: 8 },
      }),
      { status: 'cut', at: '2026-11-09T14:30:00Z' },
      'webhook',
      NOW,
    )
    expect(second.changed).toBe(true)
    expect(second.patch.cut_count).toBe(2)
    // No details on the second cut → the earlier ones are kept.
    expect(second.patch.cut_details).toEqual({ width_mm: 31.2, height_mm: 8 })
  })

  it('rejected is terminal: reason + finished_at', () => {
    const r = mergeRemoteStatus(
      row({ status: 'received', remote_updated_at: '2026-11-09T14:05:00.000Z' }),
      { status: 'rejected', at: '2026-11-09T14:40:00Z', reason: 'name too long for that style', by: 'Laser-1' },
      'webhook',
      NOW,
    )
    expect(r.changed).toBe(true)
    expect(r.patch.reject_reason).toBe('name too long for that style')
    expect(r.patch.finished_at).toBe('2026-11-09T14:40:00.000Z')
  })

  it('an app-side cancel stamps finished_at and the acting user', () => {
    const r = mergeRemoteStatus(row(), { status: 'cancelled', at: NOW, by: 'u2' }, 'app', NOW)
    expect(r.changed).toBe(true)
    expect(r.patch.finished_at).toBe(NOW)
    expect(r.patch.status_history?.at(-1)).toMatchObject({ status: 'cancelled', via: 'app', by: 'u2' })
  })

  it('never touches a final row', () => {
    for (const status of ['done', 'rejected', 'cancelled'] as const) {
      const r = mergeRemoteStatus(row({ status }), { status: 'cut', at: NOW }, 'webhook', NOW)
      expect(r.changed).toBe(false)
      expect(r.patch).toEqual({ last_synced_at: NOW, last_sync_error: null })
    }
  })

  it('an unparseable remote time counts as now (newest)', () => {
    const r = mergeRemoteStatus(
      row({ status: 'new', remote_updated_at: '2026-11-09T14:05:00.000Z' }),
      { status: 'received', at: 'yesterday-ish' },
      'poll',
      NOW,
    )
    expect(r.changed).toBe(true)
    expect(r.patch.remote_updated_at).toBe(NOW)
  })
})

describe('parsers', () => {
  it('parseHistory drops malformed entries and defaults via to poll', () => {
    const h = parseHistory([
      { status: 'new', at: '2026-11-09T14:00:00Z' },
      { status: 'bogus', at: '2026-11-09T14:00:00Z' },
      { status: 'cut', at: 12 },
      null,
      { status: 'done', at: '2026-11-09T15:00:00Z', via: 'webhook', by: 'L1', reason: null },
    ])
    expect(h).toEqual([
      { status: 'new', at: '2026-11-09T14:00:00Z', via: 'poll', by: null, reason: null },
      { status: 'done', at: '2026-11-09T15:00:00Z', via: 'webhook', by: 'L1', reason: null },
    ])
    expect(parseHistory('nope')).toEqual([])
  })

  it('parseCutDetails keeps only finite numbers', () => {
    expect(parseCutDetails({ width_mm: 30, height_mm: 'x', minutes: NaN, passes: 2 })).toEqual({
      width_mm: 30,
      height_mm: undefined,
      minutes: undefined,
      passes: 2,
    })
    expect(parseCutDetails({})).toBeNull()
    expect(parseCutDetails(null)).toBeNull()
  })
})
