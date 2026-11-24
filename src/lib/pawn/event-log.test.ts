import { describe, expect, it } from 'vitest'
import { mergePaymentMoves, type LogEvent } from './event-log'

const ev = (over: Partial<LogEvent> & { id: string }): LogEvent => ({
  event_type: 'payment',
  reverses_event_id: null,
  occurred_at: '2026-11-14T15:19:04.000Z',
  new_due_date: null,
  previous_due_date: null,
  interest_waived: 0,
  notes: null,
  ...over,
})

describe('mergePaymentMoves', () => {
  it('folds the extension written right behind a payment into the payment row', () => {
    // Newest first, as the ticket page lists them.
    const out = mergePaymentMoves([
      ev({ id: 'x', event_type: 'extension', occurred_at: '2026-11-14T15:19:05.000Z', new_due_date: '2026-12-05', previous_due_date: '2026-11-05', notes: 'By ER' }),
      ev({ id: 'p', notes: 'By ER' }),
      ev({ id: 'i', event_type: 'issued', occurred_at: '2026-10-06T15:00:00.000Z' }),
    ])
    expect(out.map((e) => e.id)).toEqual(['p', 'i'])
    expect(out[0].moved_to).toBe('2026-12-05')
    // Same note on both rows: said once.
    expect(out[0].move_notes).toBeNull()
  })

  it('keeps a different note from the extension', () => {
    const out = mergePaymentMoves([
      ev({ id: 'p' }),
      ev({ id: 'x', event_type: 'extension', occurred_at: '2026-11-14T15:19:05.000Z', new_due_date: '2026-12-05', notes: 'moved' }),
    ])
    expect(out[0].move_notes).toBe('moved')
  })

  it('never folds a move made later, free time, or the date a void put back', () => {
    const later = ev({ id: 'x1', event_type: 'extension', occurred_at: '2026-11-14T15:30:00.000Z', new_due_date: '2026-12-05' })
    const free = ev({ id: 'x2', event_type: 'extension', occurred_at: '2026-11-14T15:19:05.000Z', new_due_date: '2026-12-05', interest_waived: 30 })
    const back = ev({ id: 'x3', event_type: 'extension', occurred_at: '2026-11-14T15:19:05.000Z', new_due_date: '2026-11-05', previous_due_date: '2026-12-05' })
    for (const x of [later, free, back]) {
      const out = mergePaymentMoves([ev({ id: 'p' }), x])
      expect(out.map((e) => e.id).sort()).toEqual(['p', x.id].sort())
      expect(out.find((e) => e.id === 'p')?.moved_to).toBeNull()
    }
  })

  it('never folds a move into the row that voids a payment', () => {
    const out = mergePaymentMoves([
      ev({ id: 'r', reverses_event_id: 'p0' }),
      ev({ id: 'x', event_type: 'extension', occurred_at: '2026-11-14T15:19:05.000Z', new_due_date: '2026-12-05' }),
    ])
    expect(out).toHaveLength(2)
  })
})
