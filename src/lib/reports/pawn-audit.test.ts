import { describe, expect, it } from 'vitest'
import {
  auditItemDetail,
  buildPawnAudit,
  compareTickets,
  type PawnAuditItemInput,
  type PawnAuditLoanInput,
} from './pawn-audit'

const loan = (over: Partial<PawnAuditLoanInput>): PawnAuditLoanInput => ({
  id: 'L1',
  tenant_id: 'T',
  ticket_number: '15664',
  principal: '300.0000',
  issue_date: '2026-11-17',
  due_date: '2026-12-17',
  status: 'active',
  customer: { first_name: 'Ana', last_name: 'Diaz' },
  ...over,
})

const item = (over: Partial<PawnAuditItemInput>): PawnAuditItemInput => ({
  loan_id: 'L1',
  position: 0,
  description: 'Fancy ring',
  karat: '14.0',
  weight_grams: '4.6000',
  jewelry_size: '9',
  firearm_serial_number: null,
  electronic_serial: null,
  jewelry_serial: null,
  ...over,
})

describe('buildPawnAudit', () => {
  it('lists one row per piece and prints the ticket on its first row only', () => {
    const r = buildPawnAudit({
      tenantIds: ['T'],
      loans: [loan({})],
      items: [item({ position: 1, description: 'Chain' }), item({ position: 0 })],
    })
    expect(r.rows.map((x) => [x.ticket_number, x.first, x.item_no, x.item_count, x.description])).toEqual([
      ['15664', true, 1, 2, 'Fancy ring'],
      ['15664', false, 2, 2, 'Chain'],
    ])
    expect(r.rows[0]).toMatchObject({ customer_name: 'Diaz, Ana', principal: 300, karat: 14, weight_grams: 4.6, size: '9' })
    expect(r.totals).toEqual({ tickets: 1, pieces: 2, principal: 300, tickets_without_items: 0 })
  })

  it('leaves out every loan that is not open', () => {
    const r = buildPawnAudit({
      tenantIds: ['T'],
      loans: [
        loan({ id: 'A', ticket_number: '1', status: 'redeemed' }),
        loan({ id: 'B', ticket_number: '2', status: 'forfeited' }),
        loan({ id: 'C', ticket_number: '3', status: 'voided' }),
        loan({ id: 'D', ticket_number: '4', status: 'extended' }),
        loan({ id: 'E', ticket_number: '5', status: 'partial_paid' }),
      ],
      items: [item({ loan_id: 'A' }), item({ loan_id: 'D' }), item({ loan_id: 'E' })],
    })
    expect(r.rows.map((x) => x.ticket_number)).toEqual(['4', '5'])
    expect(r.totals?.tickets).toBe(2)
  })

  it('keeps a ticket with no pieces recorded, and counts it', () => {
    const r = buildPawnAudit({ tenantIds: ['T'], loans: [loan({})], items: [] })
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]).toMatchObject({ first: true, item_no: 0, item_count: 0, description: '' })
    expect(r.totals).toMatchObject({ tickets: 1, pieces: 0, tickets_without_items: 1 })
  })

  it('counts each ticket\'s loan amount once, however many pieces it has', () => {
    const r = buildPawnAudit({
      tenantIds: ['T'],
      loans: [loan({}), loan({ id: 'L2', ticket_number: '15665', principal: 700 })],
      items: [item({}), item({ position: 1 }), item({ loan_id: 'L2' })],
    })
    expect(r.totals).toMatchObject({ tickets: 2, pieces: 3, principal: 1000 })
  })

  it('orders tickets the way a person reads the numbers', () => {
    const r = buildPawnAudit({
      tenantIds: ['T'],
      loans: [
        loan({ id: 'a', ticket_number: '15664' }),
        loan({ id: 'b', ticket_number: '9001' }),
        loan({ id: 'c', ticket_number: 'PT-015665' }),
        loan({ id: 'd', ticket_number: '15455' }),
      ],
      items: [],
    })
    expect(r.rows.map((x) => x.ticket_number)).toEqual(['9001', '15455', '15664', 'PT-015665'])
    expect(compareTickets('9', '10')).toBeLessThan(0)
  })

  it('shows a serial number for a firearm or an electronic', () => {
    const r = buildPawnAudit({
      tenantIds: ['T'],
      loans: [loan({})],
      items: [
        item({ karat: null, weight_grams: null, jewelry_size: null, firearm_serial_number: 'BPNL281' }),
        item({ position: 1, karat: null, weight_grams: 0, jewelry_size: ' ', electronic_serial: 'C02XK' }),
      ],
    })
    expect(r.rows.map((x) => x.serial)).toEqual(['BPNL281', 'C02XK'])
    expect(r.rows[1]).toMatchObject({ weight_grams: null, size: null })
  })
})

describe('auditItemDetail', () => {
  const labels = { size: 'Size', serial: 'S/N' }
  it('joins what identifies the piece', () => {
    expect(auditItemDetail({ karat: 14, weight_grams: 4.6, size: '9', serial: null }, labels)).toBe('14k · 4.6 g · Size 9')
    expect(auditItemDetail({ karat: null, weight_grams: null, size: null, serial: 'BPNL281' }, labels)).toBe('S/N BPNL281')
    expect(auditItemDetail({ karat: 10, weight_grams: 16.556, size: null, serial: null }, labels)).toBe('10k · 16.56 g')
  })
  it('is empty when nothing is known', () => {
    expect(auditItemDetail({ karat: null, weight_grams: null, size: null, serial: null }, labels)).toBe('')
  })
})
