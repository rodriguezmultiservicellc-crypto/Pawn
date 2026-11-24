/**
 * The item popup's fields, from the browser's form to what is saved.
 *
 * createLoanAction does exactly this: readCollateralRows(formData), then
 * collateralItemSchema on each row, then gemstoneText for the printed line.
 * These tests walk the same three steps with the field names the popup
 * submits, so a renamed input or a dropped field fails here and not on a
 * customer's ticket.
 */

import { describe, expect, it } from 'vitest'
import { collateralItemSchema } from '@/lib/validations/loan'
import { readCollateralRows } from './intake-form'
import { gemstoneText } from './stones'

function form(fields: Record<string, string>, count = 1): FormData {
  const fd = new FormData()
  fd.set('collateral_count', String(count))
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

const base = {
  collateral_0_description: "14K yellow gold men's cuban link chain, 22 g",
  collateral_0_category: 'chain',
  collateral_0_pawn_category: 'jewelry',
  collateral_0_pawn_subcategory: 'chains',
  collateral_0_est_value: '1199.44',
  collateral_0_metal_type: 'gold',
  collateral_0_karat: '14',
  collateral_0_weight_grams: '22',
  collateral_0_coating: 'none',
}

function parse(fields: Record<string, string>) {
  const [row] = readCollateralRows(form({ ...base, ...fields }))
  const parsed = collateralItemSchema.safeParse({ ...row.raw, photo_path: null })
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues))
  return parsed.data
}

describe('jewelry details (patches/0106), form → saved row', () => {
  it('keeps gender, style, brand, model and serial', () => {
    const v = parse({
      collateral_0_jewelry_gender: 'men',
      collateral_0_jewelry_style: ' Cuban link ',
      collateral_0_jewelry_brand: 'Rolex',
      collateral_0_jewelry_model: 'Submariner 16610',
      collateral_0_jewelry_serial: 'X123456',
    })
    expect(v.jewelry_gender).toBe('men')
    expect(v.jewelry_style).toBe('Cuban link')
    expect(v.jewelry_brand).toBe('Rolex')
    expect(v.jewelry_model).toBe('Submariner 16610')
    expect(v.jewelry_serial).toBe('X123456')
  })

  it('saves blanks as nothing, and an item with none of it still passes', () => {
    const v = parse({
      collateral_0_jewelry_gender: '',
      collateral_0_jewelry_style: '',
      collateral_0_stones: '',
      collateral_0_gemstone_notes: '',
    })
    expect(v.jewelry_gender).toBeNull()
    expect(v.jewelry_style).toBeNull()
    expect(v.jewelry_serial).toBeNull()
    expect(v.stones).toEqual([])
    expect(v.gemstone_notes).toBeNull()
    expect(gemstoneText(v.stones, v.gemstone_notes)).toBe('')
  })

  it('refuses a gender that is not one of the four', () => {
    const [row] = readCollateralRows(form({ ...base, collateral_0_jewelry_gender: 'robot' }))
    expect(collateralItemSchema.safeParse({ ...row.raw, photo_path: null }).success).toBe(false)
  })

  it('keeps the stones from the popup and writes the printed line', () => {
    const v = parse({
      collateral_0_stones: JSON.stringify([
        { qty: '3', type: 'diamond', carat: '0.75', color: 'white', cut: 'round', clarity: 'VS1' },
        { qty: '', type: '', carat: '', color: '', cut: '', clarity: '' },
        { qty: '1', type: 'ruby', carat: '', color: '', cut: 'oval', clarity: '' },
      ]),
      collateral_0_gemstone_notes: 'prong-set',
    })
    expect(v.stones).toEqual([
      { qty: 3, type: 'diamond', carat: 0.75, color: 'white', cut: 'round', clarity: 'VS1' },
      { qty: 1, type: 'ruby', carat: null, color: '', cut: 'oval', clarity: '' },
    ])
    expect(gemstoneText(v.stones, v.gemstone_notes)).toBe(
      '3 diamond (round, white, 0.75 ct, VS1); 1 ruby (oval); prong-set',
    )
  })

  it('survives being validated twice, as the action does after the photo upload', () => {
    const once = parse({
      collateral_0_stones: JSON.stringify([{ qty: '2', type: 'emerald' }]),
    })
    const twice = collateralItemSchema.parse({ ...once, photo_path: 't/x/photo.jpg' })
    expect(twice.stones).toEqual(once.stones)
    expect(twice.jewelry_gender).toBe(once.jewelry_gender)
  })

  it('does not fail the ticket over junk in the stones field', () => {
    expect(parse({ collateral_0_stones: 'not json' }).stones).toEqual([])
    expect(parse({ collateral_0_stones: '{"qty":1}' }).stones).toEqual([])
  })

  it('still takes the one-line gemstones of a tab left open on the older form', () => {
    const v = parse({ collateral_0_gemstone_description: '3 round diamonds ~0.25ct each' })
    expect(v.stones).toEqual([])
    expect(v.gemstone_description).toBe('3 round diamonds ~0.25ct each')
  })

  it('reads the weight the popup submits in grams, whatever unit was typed', () => {
    // 5 dwt is submitted by the popup as 7.78 in collateral_0_weight_grams.
    expect(parse({ collateral_0_weight_grams: '7.78' }).weight_grams).toBe(7.78)
  })
})

describe('the rest of FS 539.001(8)(b)2.a-d (patches/0107), form → saved row', () => {
  it('keeps a tool serial, a general item brand / model / serial, and the size', () => {
    const v = parse({
      collateral_0_tool_serial: ' T-99812 ',
      collateral_0_general_brand: 'Yamaha',
      collateral_0_general_model: 'P-45',
      collateral_0_general_serial: 'YM-5521',
      collateral_0_item_size: '88 keys',
    })
    expect(v.tool_serial).toBe('T-99812')
    expect(v.general_brand).toBe('Yamaha')
    expect(v.general_model).toBe('P-45')
    expect(v.general_serial).toBe('YM-5521')
    expect(v.item_size).toBe('88 keys')
  })

  it('saves them as nothing when the boxes are empty or not on the form', () => {
    const v = parse({ collateral_0_item_size: '' })
    expect(v.item_size).toBeNull()
    expect(v.tool_serial).toBeNull()
    expect(v.general_brand).toBeNull()
  })

  it('keeps the English color and style the dropdowns submit', () => {
    const v = parse({ collateral_0_color: 'Yellow', collateral_0_jewelry_style: 'Cuban link' })
    expect(v.color).toBe('Yellow')
    expect(v.jewelry_style).toBe('Cuban link')
  })
})
