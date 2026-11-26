import { describe, expect, it } from 'vitest'
import { buildRepairDraftPayload, parseRepairDraftPayload } from './draft-payload'

function form(entries: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(entries)) fd.append(k, v)
  return fd
}

describe('repair draft payload', () => {
  it('keeps every field of the form, and reads back the same', () => {
    const payload = buildRepairDraftPayload(
      form({
        line_item_count: '2',
        li_0_item_type: 'ring',
        li_0_karat: '14K',
        li_0_weight_grams: '3.2',
        li_0_dimension: 'size 7',
        li_0_service_type: 'stone_setting',
        li_0_service_touched: '1',
        li_0_work_needed: 'Set center stone',
        li_0_price: '85.00',
        li_0_photos: JSON.stringify(['t/intake/a.jpg', 'b.jpg']),
        li_1_item_type: '',
        li_1_service_type: 'repair',
        li_1_service_touched: '0',
        stone_count: '1',
        stone_0_type: 'Diamond',
        stone_0_size_mm: '5',
        stone_0_source: 'shop_supplied',
        promised_date: '2026-12-01',
        assigned_to: 'abc',
        notes_internal: 'rush',
        est_deposit: '20',
      }),
    )
    expect(payload.line_items).toHaveLength(2)
    expect(payload.line_items[0]).toEqual({
      item_type: 'ring',
      karat: '14K',
      weight_grams: '3.2',
      dimension: 'size 7',
      service_type: 'stone_setting',
      service_touched: true,
      work_needed: 'Set center stone',
      price: '85.00',
      photos: ['t/intake/a.jpg', 'b.jpg'],
    })
    expect(payload.line_items[1].service_touched).toBe(false)
    expect(payload.line_items[1].photos).toEqual([])
    expect(payload.stones[0]).toMatchObject({ stone_type: 'Diamond', size_mm: '5', source: 'shop_supplied' })
    expect(payload.est_deposit).toBe('20')
    // Stored as JSON and read back: nothing lost.
    expect(parseRepairDraftPayload(JSON.parse(JSON.stringify(payload)))).toEqual(payload)
  })

  it('turns anything unexpected into a safe empty form', () => {
    const p = parseRepairDraftPayload({ line_items: [{ service_type: 'hack' }], stones: 'x' })
    expect(p.line_items[0].service_type).toBe('repair')
    expect(p.stones).toEqual([])
    expect(parseRepairDraftPayload(null).line_items).toEqual([])
  })
})
