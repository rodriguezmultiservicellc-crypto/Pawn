import { describe, expect, it } from 'vitest'
import { buildCustomerSalesHistory, type SaleHistoryInput } from './customer-history'

const s = (over: Partial<SaleHistoryInput>): SaleHistoryInput => ({
  id: 'x', sale_number: 'S-1', sale_kind: 'retail', status: 'completed', total: 100,
  returned_total: 0, completed_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z', ...over,
})

describe('buildCustomerSalesHistory', () => {
  it('adds up purchases net of returns; open and voided sales are not purchases', () => {
    const h = buildCustomerSalesHistory({
      sales: [
        s({ id: 'a', total: '200.0000', returned_total: '50.0000', status: 'partial_returned', completed_at: '2026-03-01T00:00:00Z' }),
        s({ id: 'b', total: 100 }),
        s({ id: 'c', status: 'voided', total: 999 }),
        s({ id: 'd', status: 'open', sale_kind: 'layaway', completed_at: null, created_at: '2026-04-01T00:00:00Z' }),
      ],
      layaways: [
        { id: 'L1', sale_id: 'd', status: 'active', balance_remaining: '120.5000' },
        { id: 'L0', sale_id: 'zz', status: 'completed', balance_remaining: 0 },
      ],
      lines: [
        { sale_id: 'a', position: 2, description: 'Chain' },
        { sale_id: 'a', position: 1, description: 'Ring' },
      ],
    })
    expect(h).toMatchObject({ purchases: 2, spent: 250, returns: 1, layaways_active: 1, layaway_owed: 120.5, layaways_completed: 1 })
    expect(h.first_date).toBe('2026-01-01T00:00:00Z')
    expect(h.recent[0]).toMatchObject({ id: 'd', kind: 'layaway', layaway_id: 'L1', status: 'active' })
    expect(h.recent[1]).toMatchObject({ id: 'a', items: ['Ring', 'Chain'], status: 'partial_returned' })
  })
})
