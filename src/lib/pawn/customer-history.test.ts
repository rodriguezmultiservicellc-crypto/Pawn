import { describe, expect, it } from 'vitest'
import {
  buildCustomerPawnHistory,
  pawnItemLabel,
  HISTORY_ITEMS_MAX,
  type HistoryItemInput,
  type HistoryLoanInput,
} from './customer-history'

const loan = (over: Partial<HistoryLoanInput>): HistoryLoanInput => ({
  id: 'L',
  ticket_number: '100',
  status: 'redeemed',
  principal: '300.0000',
  issue_date: '2025-01-10',
  ...over,
})

const item = (over: Partial<HistoryItemInput>): HistoryItemInput => ({
  loan_id: 'L',
  position: 0,
  description: 'Figaro chain',
  category: 'chain',
  metal_type: 'gold',
  karat: '10.0',
  weight_grams: '23.6000',
  est_value: '500.0000',
  jewelry_size: '24',
  color: 'Yellow Gold',
  gemstone_description: null,
  unique_marks: null,
  pawn_category_slug: 'jewelry',
  pawn_subcategory_slug: 'chains',
  firearm_make: null,
  firearm_model: null,
  firearm_caliber: null,
  firearm_serial_number: null,
  firearm_type: null,
  electronic_brand: null,
  electronic_model: null,
  electronic_serial: null,
  tool_brand: null,
  tool_model: null,
  ...over,
})

describe('pawnItemLabel', () => {
  it('reads karat, the piece and its weight', () => {
    expect(pawnItemLabel({ description: 'Figaro chain', karat: '10.0', weight_grams: '23.6000' })).toBe('10k Figaro chain 23.6g')
  })
  it('does not repeat a karat the description already says', () => {
    expect(pawnItemLabel({ description: '10k box chain', karat: 10, weight_grams: 34.3 })).toBe('10k box chain 34.3g')
    expect(pawnItemLabel({ description: 'Bracelet 14k cuban link', karat: 14, weight_grams: null })).toBe('Bracelet 14k cuban link')
  })
  it('is just the description for a piece with no metal facts', () => {
    expect(pawnItemLabel({ description: 'Glock 19X', karat: null, weight_grams: 0 })).toBe('Glock 19X')
  })
})

describe('buildCustomerPawnHistory', () => {
  it('counts picked up, lost and open, and leaves voided out of the total', () => {
    const h = buildCustomerPawnHistory({
      loans: [
        loan({ id: 'a', status: 'redeemed' }),
        loan({ id: 'b', status: 'redeemed' }),
        loan({ id: 'c', status: 'forfeited' }),
        loan({ id: 'd', status: 'active', principal: 200 }),
        loan({ id: 'e', status: 'partial_paid', principal: 150.5 }),
        loan({ id: 'f', status: 'voided' }),
      ],
      items: [],
    })
    expect(h).toMatchObject({ total: 5, redeemed: 2, forfeited: 1, open: 2, voided: 1, open_principal: 350.5 })
  })

  it('offers only pieces that were picked up — never a lost one', () => {
    const h = buildCustomerPawnHistory({
      loans: [loan({ id: 'won', status: 'redeemed' }), loan({ id: 'lost', status: 'forfeited' }), loan({ id: 'here', status: 'active' })],
      items: [
        item({ loan_id: 'won', description: 'Figaro chain' }),
        item({ loan_id: 'lost', description: 'Wedding band', weight_grams: 4 }),
        item({ loan_id: 'here', description: 'Cuban bracelet', weight_grams: 19.5 }),
      ],
    })
    expect(h.previous_items.map((p) => p.label)).toEqual(['10k Figaro chain 23.6g'])
  })

  it('the same piece pawned many times is one entry with its newest value', () => {
    const h = buildCustomerPawnHistory({
      loans: [
        loan({ id: 'old', ticket_number: '90', issue_date: '2023-03-01' }),
        loan({ id: 'new', ticket_number: '200', issue_date: '2026-02-01' }),
        loan({ id: 'mid', ticket_number: '150', issue_date: '2024-06-01' }),
      ],
      items: [
        item({ loan_id: 'old', est_value: 300 }),
        item({ loan_id: 'new', est_value: 550 }),
        item({ loan_id: 'mid', est_value: 400, description: 'figaro  CHAIN' }),
      ],
    })
    expect(h.previous_items).toHaveLength(1)
    expect(h.previous_items[0]).toMatchObject({ times: 3, last_value: 550, last_date: '2026-02-01', last_ticket: '200', karat: 10, weight_grams: 23.6 })
    expect(h.first_date).toBe('2023-03-01')
  })

  it('lists recent tickets newest first with their pieces', () => {
    const h = buildCustomerPawnHistory({
      loans: [loan({ id: 'a', ticket_number: '1', issue_date: '2024-01-01' }), loan({ id: 'b', ticket_number: '2', issue_date: '2026-01-01', status: 'forfeited' })],
      items: [item({ loan_id: 'b', position: 1, description: 'Ring', weight_grams: 4 }), item({ loan_id: 'b', position: 0 })],
    })
    expect(h.recent.map((r) => [r.ticket_number, r.outcome])).toEqual([['2', 'forfeited'], ['1', 'redeemed']])
    expect(h.recent[0].items).toEqual(['10k Figaro chain 23.6g', '10k Ring 4g'])
  })

  it('caps the pieces offered', () => {
    const loans = Array.from({ length: 30 }, (_, i) => loan({ id: `l${i}`, issue_date: `2025-01-${String(i + 1).padStart(2, '0')}` }))
    const items = loans.map((l, i) => item({ loan_id: l.id, description: `Piece ${i}` }))
    expect(buildCustomerPawnHistory({ loans, items }).previous_items).toHaveLength(HISTORY_ITEMS_MAX)
  })

  it('a customer with no tickets has an empty history', () => {
    expect(buildCustomerPawnHistory({ loans: [], items: [] })).toMatchObject({ total: 0, first_date: null, recent: [], previous_items: [] })
  })
})
