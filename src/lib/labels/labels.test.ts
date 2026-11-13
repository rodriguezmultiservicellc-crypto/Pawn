import { describe, it, expect } from 'vitest'
import { CODE128_PATTERNS, Code128Error, encodeCode128 } from './code128'
import { checkCostCodeWord, encodeCost } from './cost-code'
import { parseScan, collateralCode } from './scan'
import {
  buildCollateralTag,
  buildInventoryTag,
  buildRepairTag,
  inventoryBarcode,
  metalLine,
  priceLine,
  stonesLine,
  tagDate,
  weightLine,
} from './tag-content'
import { fitText, layoutTag } from './layout'
import { renderZplLabel, zplText } from './zpl'
import { BUILTIN_TEMPLATES, pickTemplate, tagPanels, templateChoices, templateKey, type TagTemplate } from './templates'

const toBin = (widths: number[]) => widths.map((w, i) => (i % 2 === 0 ? '1' : '0').repeat(w)).join('')

describe('code128 pattern table', () => {
  it('has 107 unique patterns of 11 modules, stop of 13', () => {
    expect(CODE128_PATTERNS).toHaveLength(107)
    expect(new Set(CODE128_PATTERNS).size).toBe(107)
    CODE128_PATTERNS.slice(0, 106).forEach((p) => {
      expect([...p].reduce((a, c) => a + Number(c), 0)).toBe(11)
    })
    expect([...CODE128_PATTERNS[106]].reduce((a, c) => a + Number(c), 0)).toBe(13)
  })
})

describe('encodeCode128', () => {
  // Reference symbols produced by JsBarcode 3.11.6 (CODE128B / CODE128C).
  it('matches the reference symbol for "INV-" in set B', () => {
    expect(toBin(encodeCode128('INV-').widths)).toBe(
      '1101001000011000100010101110001101110101100010011011100110100010001100011101011',
    )
  })
  it('matches the reference symbol for "000123" in set C', () => {
    expect(toBin(encodeCode128('000123').widths)).toBe(
      '11010011100110110011001100110110011101101110100001101001100011101011',
    )
  })
  it('switches B→C for a trailing 6-digit run and stays short', () => {
    const c = encodeCode128('INV-000123')
    // start B, I N V -, code C, 00 01 23, check, stop
    expect(c.values).toHaveLength(11)
    expect(c.values[0]).toBe(104)
    expect(c.values[5]).toBe(99)
    expect(c.values.slice(6, 9)).toEqual([0, 1, 23])
    expect(c.modules).toBe(10 * 11 + 13)
  })
  it('spends the first digit of an odd run in B', () => {
    const c = encodeCode128('PT-12345')
    // P T - 1 (B), code C, 23 45
    expect(c.values.slice(1, 5)).toEqual([48, 52, 13, 17])
    expect(c.values[5]).toBe(99)
    expect(c.values.slice(6, 8)).toEqual([23, 45])
  })
  it('keeps short digit runs in B', () => {
    const c = encodeCode128('PT-000123-2')
    expect(c.values.includes(100)).toBe(true) // back to B for "-2"
  })
  it('rejects empty and non-printable input', () => {
    expect(() => encodeCode128('')).toThrow(Code128Error)
    expect(() => encodeCode128('é')).toThrow(Code128Error)
  })
})

describe('parseScan', () => {
  it('reads SKUs, bare numbers and padded numbers', () => {
    expect(parseScan('INV-000123')).toEqual({ kind: 'inventory', sku: 'INV-000123', skuNumber: 123 })
    expect(parseScan('inv-000123\r\n')).toEqual({ kind: 'inventory', sku: 'INV-000123', skuNumber: 123 })
    expect(parseScan('000123')).toEqual({ kind: 'inventory', sku: 'INV-000123', skuNumber: 123 })
    expect(parseScan('123')).toEqual({ kind: 'inventory', sku: 'INV-000123', skuNumber: 123 })
  })
  it('reads collateral and repair codes', () => {
    expect(parseScan('PT-000045-2')).toEqual({ kind: 'collateral', ticketNumber: 'PT-000045', position: 2 })
    expect(parseScan('rt-000003')).toEqual({ kind: 'repair', ticketNumber: 'RT-000003' })
  })
  it('passes legacy SKU text through untouched', () => {
    expect(parseScan('  A-77b ')).toEqual({ kind: 'inventory', sku: 'A-77b', skuNumber: null })
    expect(parseScan('   ')).toEqual({ kind: 'empty' })
  })
  it('collateral codes are 1-based', () => {
    expect(collateralCode('PT-000045', 0)).toBe('PT-000045-1')
  })
})

describe('cost code', () => {
  it('validates the word', () => {
    expect(checkCostCodeWord('blackhorse')).toEqual({ ok: true, word: 'BLACKHORSE' })
    expect(checkCostCodeWord('BLACK')).toEqual({ ok: false, error: 'cost_code_length' })
    expect(checkCostCodeWord('BLACKHORS3')).toEqual({ ok: false, error: 'cost_code_letters' })
    expect(checkCostCodeWord('BLACKHORSB')).toEqual({ ok: false, error: 'cost_code_repeat' })
  })
  it('encodes whole dollars, 0 as the tenth letter', () => {
    expect(encodeCost(1250, 'BLACKHORSE')).toBe('BLKE')
    expect(encodeCost(1249.6, 'BLACKHORSE')).toBe('BLKE')
    expect(encodeCost(0, 'BLACKHORSE')).toBeNull()
    expect(encodeCost(100, null)).toBeNull()
  })
})

describe('tag content', () => {
  it('formats trade lines language-neutrally', () => {
    expect(metalLine('gold', '14')).toBe('14K YG')
    expect(metalLine('white_gold', '18k')).toBe('18K WG')
    expect(metalLine('silver', '925')).toBe('925 AG')
    expect(metalLine(null, null)).toBe('')
    expect(weightLine('4.200')).toBe('4.2g')
    expect(weightLine(0)).toBe('')
    expect(priceLine(1250)).toBe('$1,250')
    expect(priceLine('99.5')).toBe('$99.50')
    expect(priceLine(null)).toBeNull()
    expect(tagDate('2026-12-05')).toBe('12/5/26')
  })
  it('sums stones, honouring total-carat rows', () => {
    expect(stonesLine([{ count: 3, carat: 0.1, is_total_carat: false }, { count: 1, carat: 0.5, is_total_carat: true }])).toBe('4st 0.8ct')
    expect(stonesLine([])).toBe('')
  })
  it('uses the short number payload only for trigger-made SKUs', () => {
    expect(inventoryBarcode({ sku: 'INV-000123', sku_number: 123 }, 'number')).toBe('000123')
    expect(inventoryBarcode({ sku: 'LEG-55', sku_number: 0 }, 'number')).toBe('LEG-55')
    expect(inventoryBarcode({ sku: 'INV-000123', sku_number: 123 }, 'code')).toBe('INV-000123')
  })
  it('never prints cost in clear, only coded when asked', () => {
    const item = {
      sku: 'INV-000123', sku_number: 123, list_price: 1250, metal: 'gold', karat: '14',
      weight_grams: 4.2, description: 'Cuban link chain 22in', cost_basis: 610, stones: [],
    }
    const plain = buildInventoryTag({ item, fields: { price: true, metal: true, weight: true, cost_code: false }, payload: 'number', costCodeWord: 'BLACKHORSE', shopName: null })
    expect(plain.headline).toBe('$1,250')
    expect(plain.lines).toEqual(['14K YG · 4.2g'])
    expect(JSON.stringify(plain)).not.toContain('610')
    const coded = buildInventoryTag({ item, fields: { cost_code: true }, payload: 'number', costCodeWord: 'BLACKHORSE', shopName: null })
    expect(coded.lines).toEqual(['HBE'])
    expect(coded.headline).toBeNull()
  })
  it('collateral and repair tags carry the ticket, no customer', () => {
    const c = buildCollateralTag({
      item: { ticket_number: 'PT-000045', position: 1, description: 'Ring', metal_type: 'gold', karat: 10, weight_grams: 3, due_date: '2026-12-15' },
      fields: { metal: true, weight: true, description: true, due_date: true },
    })
    expect(c.barcode).toBe('PT-000045-2')
    expect(c.lines).toEqual(['10K YG · 3g', 'Ring', 'Due/Vence 12/15/26'])
    const r = buildRepairTag({ item: { ticket_number: 'RT-000003', title: 'Size ring 7', promised_date: null }, fields: { description: true, due_date: true } })
    expect(r).toEqual({ kind: 'repair', barcode: 'RT-000003', code: 'RT-000003', headline: null, lines: ['Size ring 7'] })
  })
})

describe('templates', () => {
  it('falls back to the built-in default per kind', () => {
    expect(pickTemplate([], 'inventory').name).toBe('Rat-tail tag')
    expect(pickTemplate([], 'collateral').kind).toBe('collateral')
  })
  it('prefers the requested, then the tenant default', () => {
    const mine: TagTemplate = { ...BUILTIN_TEMPLATES[2], id: 'a', is_default: false }
    const def: TagTemplate = { ...BUILTIN_TEMPLATES[1], id: 'b', is_default: true }
    expect(pickTemplate([mine, def], 'inventory').id).toBe('b')
    expect(pickTemplate([mine, def], 'inventory', 'a').id).toBe('a')
    expect(pickTemplate([mine, def], 'collateral').id).toBeNull()
  })
  it('can request a non-default built-in by key', () => {
    expect(pickTemplate([], 'inventory', 'builtin:Barbell tag').name).toBe('Barbell tag')
    expect(pickTemplate([], 'inventory', 'builtin:Repair envelope label').name).toBe('Rat-tail tag')
  })
  it('offers saved then built-ins, with exactly one default', () => {
    const mine: TagTemplate = { ...BUILTIN_TEMPLATES[2], id: 'a', name: 'Mine', is_default: true }
    const c = templateChoices([mine], 'inventory')
    expect(c.map((x) => x.key)).toEqual(['a', 'builtin:Rat-tail tag', 'builtin:Barbell tag', 'builtin:Rectangular label'])
    expect(c.filter((x) => x.isDefault).map((x) => x.key)).toEqual(['a'])
    expect(templateKey(BUILTIN_TEMPLATES[0])).toBe('builtin:Rat-tail tag')
  })
  it('splits wings around the gap', () => {
    const p = tagPanels({ width_in: 2.2, layout: 'split', gap_in: 0.6 })
    expect(p).toHaveLength(2)
    expect(p[0].x).toBe(0)
    expect(p[0].w).toBeCloseTo(0.8)
    expect(p[1].x).toBeCloseTo(1.4)
    expect(p[1].w).toBeCloseTo(0.8)
  })
})

describe('layout + zpl', () => {
  const ratTail = BUILTIN_TEMPLATES[0]
  const content = buildInventoryTag({
    item: { sku: 'INV-000123', sku_number: 123, list_price: 1250, metal: 'gold', karat: '14', weight_grams: 4.2, description: 'Cuban link chain', cost_basis: 0, stones: [] },
    fields: ratTail.fields, payload: ratTail.barcode_payload, costCodeWord: null, shopName: null,
  })

  it('fits the number payload on a rat-tail wing with 2-dot bars at 203 dpi', () => {
    const l = layoutTag(ratTail, content)
    expect(l.barcode?.moduleDots).toBeGreaterThanOrEqual(2)
    expect(l.warnings).not.toContain('barcode_too_wide')
    // Bars stay inside the left wing.
    const last = l.barcode!.bars[l.barcode!.bars.length - 1]
    expect(last.x + last.w).toBeLessThanOrEqual(1.1)
  })

  it('flags a payload that cannot fit', () => {
    const tiny: TagTemplate = { ...ratTail, width_in: 0.6, layout: 'single' }
    const l = layoutTag(tiny, { ...content, barcode: 'INV-000123-ABCDEFGHIJ' })
    expect(l.barcode).toBeNull()
    expect(l.warnings).toContain('barcode_too_wide')
  })

  it('clips text to the box', () => {
    expect(fitText('abcdefghijklmnop', 0.3, 0.07)).toHaveLength(7)
    expect(fitText('abc', 0.3, 0.07)).toBe('abc')
  })

  it('renders one bar box per bar and escapes command characters', () => {
    const { zpl } = renderZplLabel(ratTail, content)
    const bars = (zpl.match(/\^GB/g) ?? []).length
    expect(bars).toBe(layoutTag(ratTail, content).barcode!.bars.length)
    expect(zpl.startsWith('^XA')).toBe(true)
    expect(zpl.endsWith('^XZ')).toBe(true)
    expect(zpl).toContain('^PW447') // 2.2in × 203
    expect(zplText('a^b~c…·')).toBe('a b c...-')
  })
})
