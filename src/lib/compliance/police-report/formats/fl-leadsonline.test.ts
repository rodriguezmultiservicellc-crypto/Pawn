import { describe, expect, it } from 'vitest'
import type { ComplianceLogRow } from '@/types/database-aliases'
import { flattenComplianceRow } from './fl-leadsonline'

/** A pawn intake row as createLoanAction writes it, with one item. */
function intake(item: Record<string, unknown>): ComplianceLogRow {
  return {
    event_type: 'pawn_intake',
    occurred_at: '2026-11-24T15:00:00Z',
    amount: 100,
    customer_snapshot: { first_name: 'Ana', last_name: 'Perez' },
    items_snapshot: [{ description: 'Item', est_value: 100, ...item }],
  } as unknown as ComplianceLogRow
}
const flat = (item: Record<string, unknown>) =>
  flattenComplianceRow(intake(item), { tenantStoreId: 'S1' })[0]

describe('LeadsOnline: serial, brand and model of a pawned item (FS 539.001(8)(b)2.a-c)', () => {
  it('reads them from a firearm', () => {
    const r = flat({
      firearm_make: 'Glock',
      firearm_model: '19 Gen 5',
      firearm_serial_number: 'ABC123',
      electronic_serial: null,
      jewelry_serial: null,
    })
    expect(r.item_serial).toBe('ABC123')
    expect(r.item_brand).toBe('Glock')
    expect(r.item_model).toBe('19 Gen 5')
  })

  it('reads them from electronics', () => {
    const r = flat({
      firearm_serial_number: null,
      electronic_brand: 'Apple',
      electronic_model: 'iPhone 13 Pro',
      electronic_serial: 'IMEI-1',
    })
    expect(r.item_serial).toBe('IMEI-1')
    expect(r.item_brand).toBe('Apple')
    expect(r.item_model).toBe('iPhone 13 Pro')
  })

  it('reads them from a watch under Jewelry (patches/0106)', () => {
    const r = flat({
      firearm_serial_number: null,
      electronic_serial: null,
      jewelry_brand: 'Rolex',
      jewelry_model: 'Submariner 16610',
      jewelry_serial: 'X123456',
    })
    expect(r.item_serial).toBe('X123456')
    expect(r.item_brand).toBe('Rolex')
    expect(r.item_model).toBe('Submariner 16610')
  })

  it('reads a tool brand, model and serial (patches/0107)', () => {
    const r = flat({ tool_brand: 'DeWalt', tool_model: 'DCD777', tool_serial: 'T-99812' })
    expect(r.item_brand).toBe('DeWalt')
    expect(r.item_model).toBe('DCD777')
    expect(r.item_serial).toBe('T-99812')
  })

  it('reads them from a general item (patches/0107)', () => {
    const r = flat({ general_brand: 'Yamaha', general_model: 'P-45', general_serial: 'YM-5521' })
    expect(r.item_brand).toBe('Yamaha')
    expect(r.item_model).toBe('P-45')
    expect(r.item_serial).toBe('YM-5521')
  })

  it('still reads the plain names a buy snapshot uses, and prefers them', () => {
    const r = flat({ serial_number: 'BUY-1', brand: 'Sony', model: 'A7', electronic_serial: 'OTHER' })
    expect(r.item_serial).toBe('BUY-1')
    expect(r.item_brand).toBe('Sony')
    expect(r.item_model).toBe('A7')
  })

  it('leaves them empty for a plain gold chain', () => {
    const r = flat({ metal_type: 'gold', jewelry_serial: null, jewelry_brand: null })
    expect(r.item_serial).toBe('')
    expect(r.item_brand).toBe('')
    expect(r.item_model).toBe('')
  })
})
