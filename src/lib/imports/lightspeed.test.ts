import { describe, expect, it } from 'vitest'
import { parseCsv } from './csv'
import {
  checkLightspeedHeaders,
  findGrams,
  findSize,
  guessMetal,
  htmlToText,
  mapCategory,
  mapLightspeedRows,
  MAX_UNITS_PER_ROW,
} from './lightspeed'

const HEADER =
  'id,handle,sku,composite_name,composite_sku,composite_quantity,name,description,product_category,' +
  'variant_option_one_name,variant_option_one_value,variant_option_two_name,variant_option_two_value,' +
  'variant_option_three_name,variant_option_three_value,tags,active_online,weight,weight_unit,length,width,' +
  'height,dimensions_unit,supply_price,retail_price,account_code,account_code_purchase,brand_name,supplier_name,' +
  'supplier_code,active,track_inventory,outlet_tax_Main,inventory_Main,reorder_point_Main,reorder_quantity_Main,' +
  'min_quantity_Main,max_quantity_Main'

// Real-shaped rows: quoted HTML with embedded newlines and "" inch marks.
const CSV = [
  HEADER,
  `p1,10-oval-curb-child-id,12619,,,,10 Oval Curb Child ID,"<p>10k yellow gold Child Curb ID</p>
<p> </p>",bracelet,Model,"2.5mm /1.9g/5.5""",,,,,10K;curb;oval;id;bracelet;CHILD;YELLOW GOLD,1,,,,,,,72.2,160.00,,,Eddy's Jewelers,,,1,1,Default Tax,2,,,,`,
  `p2,xo-bracelet-14k,12572,,,,XO Bracelet 14k,<p>14k XO Bracelet 14k</p>,,,,,,,,xoxo;bracelet;14k,1,6.3,G,0,0,0,IN,315,700.00,,,Eddy's Jewelers,LAMAR DIAMOND JEWELRY,,1,1,Default Tax,1,,,,`,
  `p3,sold-out,13000,,,,14k Rope Chain,,chain,,,,,,,,1,,,,,,,100,200,,,,,,1,1,Default Tax,0,,,,`,
  `p4,oversold,13001,,,,14k Box Chain,,chain,,,,,,,,1,,,,,,,100,200,,,,,,1,1,Default Tax,-2,,,,`,
  `p5,the-basics,13002,,,,The Basics,,repair,,,,,,,,1,,,,,,,0,25,,,,,,1,0,Default Tax,5,,,,`,
  `p6,credit,13003,,,,CREDIT,,,,,,,,,,1,,,,,,,0,0,,,,,,1,1,Default Tax,3,,,,`,
  `p7,gf-beads,13004,,,,Gold Filled Bead Bracelet,,,color,teal,,,,,,1,,,,,,,10,40,,,,EVM Collections,,1,1,Default Tax,1,,,,`,
].join('\n')

describe('Lightspeed product export', () => {
  const { headers, rows } = parseCsv(CSV)

  it('detects the export and its outlet', () => {
    expect(checkLightspeedHeaders(headers)).toEqual({ ok: true, outlets: ['Main'] })
    expect(checkLightspeedHeaders(['First Name', 'Last Name'])).toMatchObject({ ok: false })
  })

  it('creates one item per unit on hand, idempotently', () => {
    const base = { rows, outlet: 'Main', tenantId: 't1', createdBy: 'u1', acquiredAt: '2026-11-21' }
    const first = mapLightspeedRows({ ...base, existingRefs: new Set() })
    expect(first.report).toMatchObject({
      totalRows: 7,
      toInsert: 4, // p1 ×2, p2 ×1, p7 ×1
      productsImported: 3,
      skippedNoStock: 2, // p3 zero, p4 negative
      skippedService: 2, // p5 untracked repair, p6 CREDIT
      skippedExisting: 0,
    })
    expect(first.records.map((r) => r.import_ref)).toEqual(['p1#1', 'p1#2', 'p2#1', 'p7#1'])

    // Stock went from 2 to 3 on p1: a re-run adds only the new unit.
    const rows2 = rows.map((r) => (r.id === 'p1' ? { ...r, inventory_Main: '3' } : r))
    const again = mapLightspeedRows({
      ...base,
      rows: rows2,
      existingRefs: new Set(first.records.map((r) => r.import_ref as string)),
    })
    expect(again.records.map((r) => r.import_ref)).toEqual(['p1#3'])
    expect(again.report.skippedExisting).toBe(4)
  })

  it('maps the row fields', () => {
    const { records } = mapLightspeedRows({
      rows, outlet: 'Main', tenantId: 't1', createdBy: 'u1', acquiredAt: '2026-11-21', existingRefs: new Set(),
    })
    const p1 = records[0]
    expect(p1).toMatchObject({
      tenant_id: 't1',
      sku: '',
      description: '10 Oval Curb Child ID — 2.5mm /1.9g/5.5"',
      category: 'bracelet',
      metal: 'gold',
      karat: '10K',
      weight_grams: 1.9,
      coating: 'none',
      legacy_code: '12619',
      cost_basis: 72.2,
      acquired_cost: 72.2,
      list_price: 160,
      source: 'new_stock',
      status: 'available',
      condition: 'new',
      import_source: 'lightspeed',
      acquired_at: '2026-11-21',
    })
    expect(p1.notes).toBe('Imported from Lightspeed, outlet Main on 2026-11-21.\n10k yellow gold Child Curb ID')
    expect(p1.tags).toContain('curb')

    const p2 = records[2]
    expect(p2).toMatchObject({ weight_grams: 6.3, karat: '14K', source_vendor: 'LAMAR DIAMOND JEWELRY' })
    expect(p2.notes).toBe('Imported from Lightspeed, outlet Main on 2026-11-21.\n14k XO Bracelet 14k')

    const p7 = records[3]
    expect(p7).toMatchObject({ coating: 'gold_filled', category: 'bracelet', description: 'Gold Filled Bead Bracelet — teal' })
  })

  it('caps a runaway on-hand count', () => {
    const big = rows.map((r) => (r.id === 'p2' ? { ...r, inventory_Main: String(MAX_UNITS_PER_ROW + 50) } : r))
    const { report } = mapLightspeedRows({
      rows: big, outlet: 'Main', tenantId: 't', createdBy: 'u', acquiredAt: '2026-11-21', existingRefs: new Set(),
    })
    expect(report.cappedRows).toBe(1)
    expect(report.toInsert).toBe(2 + MAX_UNITS_PER_ROW + 1)
  })
})

describe('field readers', () => {
  it('strips HTML descriptions', () => {
    expect(htmlToText('<p>length: 7.5&quot;</p>\n<p>width:&nbsp;6mm</p>')).toBe('length: 7.5" · width: 6mm')
    expect(htmlToText('<p> </p>')).toBeNull()
  })

  it('finds grams in the places Lightspeed shops put them', () => {
    expect(findGrams({ weight: '6.3', weight_unit: 'G' })).toBe(6.3)
    expect(findGrams({ weight: '2', weight_unit: 'LB' })).toBeNull()
    expect(findGrams({ variant_option_one_name: 'grams', variant_option_one_value: '3.1g/Plain' })).toBe(3.1)
    expect(findGrams({ variant_option_one_name: 'WEIGHT', variant_option_one_value: '2.4' })).toBe(2.4)
    expect(findGrams({ variant_option_one_name: 'Model', variant_option_one_value: '4mm' })).toBeNull()
    expect(findGrams({ name: 'Rope 5 grams' })).toBe(5)
    expect(findGrams({ description: '<p>weight: 6.0g</p>' })).toBe(6)
  })

  it('reads metal, karat and coating', () => {
    expect(guessMetal(['14k White Gold Band'])).toEqual({ metal: 'white_gold', karat: '14K', coating: 'none' })
    expect(guessMetal(['10ky comfort fit band'])).toMatchObject({ metal: 'gold', karat: '10K' })
    expect(guessMetal(['925 Gold Plated Necklace'])).toEqual({ metal: 'silver', karat: '925', coating: 'gold_plated' })
    expect(guessMetal(['CHARM GF 5MM CORAL'])).toMatchObject({ coating: 'gold_filled' })
    // Rhodium plating on white gold is not a gold coating.
    expect(guessMetal(['14k white gold rhodium plated'])).toMatchObject({ coating: 'none', karat: '14K' })
    // "ct" is carat (stones), not karat.
    expect(guessMetal(['1/4 ct diamond band'])).toMatchObject({ karat: null })
    expect(guessMetal(['Armitron watch'])).toEqual({ metal: null, karat: null, coating: 'none' })
  })

  it('maps categories', () => {
    expect(mapCategory('Earring', '10k Hoops', null)).toBe('earrings')
    expect(mapCategory('RING', 'x', null)).toBe('ring')
    expect(mapCategory('charm', 'x', null)).toBe('pendant')
    expect(mapCategory('ANKLET', 'x', null)).toBe('bracelet')
    expect(mapCategory(null, '10k Wedding Set', null)).toBe('ring')
    expect(mapCategory('set', '10k Clover Set', null, '1.7g/8/Ring')).toBe('ring')
    expect(mapCategory(null, '10k Heart', null, 'Necklace/2.0g/18"')).toBe('necklace')
    expect(mapCategory(null, 'Men Chronograph', 'Invicta')).toBe('watch')
    expect(mapCategory(null, '10k Flat Gucci', null)).toBe('chain')
    expect(mapCategory(null, 'Febreze', null)).toBe('other')
  })
})

describe('findSize', () => {
  it('takes the value of an option named size or length (EN/ES)', () => {
    expect(findSize({ variant_option_one_name: 'Color', variant_option_one_value: 'Yellow', variant_option_two_name: 'Ring Size', variant_option_two_value: '7.5' })).toBe('7.5')
    expect(findSize({ variant_option_one_name: 'Length', variant_option_one_value: '20"' })).toBe('20"')
    expect(findSize({ variant_option_one_name: 'Largo', variant_option_one_value: '55 cm' })).toBe('55 cm')
  })
  it('returns null when no option is a size', () => {
    expect(findSize({ variant_option_one_name: 'Grams', variant_option_one_value: '2.4' })).toBeNull()
    expect(findSize({})).toBeNull()
  })
})

describe('import stamp in notes', () => {
  it('names the source, outlet, file and date', () => {
    const { records } = mapLightspeedRows({
      rows: parseCsv(`id,sku,name,supply_price,retail_price,inventory_Main_Store\np1,1,Plain Band,10,20,1`).rows,
      outlet: 'Main_Store', tenantId: 't', createdBy: 'u', acquiredAt: '2026-11-21',
      existingRefs: new Set(), fileName: 'export.csv',
    })
    expect(records[0].notes).toBe('Imported from Lightspeed, outlet Main Store, file export.csv on 2026-11-21.')
  })
})
