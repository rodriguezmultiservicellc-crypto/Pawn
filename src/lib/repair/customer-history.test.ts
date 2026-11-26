import { describe, expect, it } from 'vitest'
import { buildCustomerRepairHistory, type RepairHistoryInput } from './customer-history'

const t = (over: Partial<RepairHistoryInput>): RepairHistoryInput => ({
  id: 'x', ticket_number: 'RT-1', status: 'intake', title: 'Ring sizing', item_description: null,
  quote_amount: null, balance_due: null, created_at: '2026-01-01T10:00:00Z', ...over,
})

describe('buildCustomerRepairHistory', () => {
  it('counts what is still here, ready, picked up, abandoned; voided apart', () => {
    const h = buildCustomerRepairHistory([
      t({ id: 'a', status: 'in_progress', balance_due: '40.0000', created_at: '2026-03-01T00:00:00Z' }),
      t({ id: 'b', status: 'ready', balance_due: 25, created_at: '2026-02-01T00:00:00Z' }),
      t({ id: 'c', status: 'picked_up', balance_due: 0 }),
      t({ id: 'd', status: 'abandoned', balance_due: 90, created_at: '2025-06-01T00:00:00Z' }),
      t({ id: 'e', status: 'voided', created_at: '2024-01-01T00:00:00Z' }),
    ])
    expect(h).toMatchObject({ total: 4, open: 2, ready: 1, picked_up: 1, abandoned: 1, voided: 1, open_balance: 65 })
    expect(h.first_date).toBe('2025-06-01T00:00:00Z')
    expect(h.recent.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
  it('falls back to the item description and reads the quote', () => {
    const h = buildCustomerRepairHistory([t({ title: '', item_description: 'Chain', quote_amount: '55.5000' })])
    expect(h.recent[0]).toMatchObject({ title: 'Chain', quote: 55.5 })
  })
})
