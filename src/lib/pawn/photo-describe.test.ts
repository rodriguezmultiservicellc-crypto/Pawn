import { describe, expect, it } from 'vitest'
import {
  PhotoItemSchema,
  photoItemPatch,
  seenCategory,
  type PhotoItem,
} from './photo-describe'

const nothing: PhotoItem = {
  readable: true,
  photos_differ: false,
  item_seen: '',
  category_slug: null,
  subcategory_slug: null,
  color: null,
  unique_marks: null,
  brand: null,
  model: null,
  serial: null,
  metal_type: null,
  karat: null,
  coating: null,
  gender: null,
  style: null,
  size: null,
  folded_in_half: null,
  scale_reading: null,
  stones: [],
  stone_notes: null,
  firearm_type: null,
  firearm_caliber: null,
  firearm_finish: null,
  firearm_action: null,
  firearm_barrels: null,
}

describe('PhotoItemSchema', () => {
  it('takes an answer with everything null', () => {
    expect(PhotoItemSchema.parse(nothing)).toEqual(nothing)
  })

  it('refuses a metal the shop does not have', () => {
    expect(PhotoItemSchema.safeParse({ ...nothing, metal_type: 'brass' }).success).toBe(false)
  })
})

describe('photoItemPatch — what the photo did not show is left alone', () => {
  it('an empty answer changes nothing', () => {
    expect(photoItemPatch(nothing, 'jewelry', 'ring')).toEqual({})
    expect(photoItemPatch(nothing, 'firearms', 'other')).toEqual({})
    expect(photoItemPatch(nothing, 'electronics', 'electronics')).toEqual({})
  })
})

describe('photoItemPatch — jewelry', () => {
  it('a stamped yellow Cuban chain', () => {
    const patch = photoItemPatch(
      {
        ...nothing,
        color: 'yellow',
        metal_type: 'gold',
        karat: 14,
        gender: 'men',
        style: 'cuban link',
        unique_marks: '  Stamped "14K ITALY"   on the clasp ',
      },
      'jewelry',
      'chain',
    )
    expect(patch).toEqual({
      // The shop's own words, whatever case the answer came in.
      color: 'Yellow',
      jewelry_style: 'Cuban link',
      metal_type: 'gold',
      karat: '14',
      jewelry_gender: 'men',
      unique_marks: 'Stamped "14K ITALY" on the clasp',
    })
  })

  it('keeps a style that is not on the list as it came', () => {
    expect(photoItemPatch({ ...nothing, style: 'Miami Cuban' }, 'jewelry', 'chain').jewelry_style).toBe(
      'Miami Cuban',
    )
  })

  it('a ring style is not a chain style', () => {
    // "Solitaire" is offered for rings; for a chain it stays as typed.
    expect(photoItemPatch({ ...nothing, style: 'solitaire' }, 'jewelry', 'ring').jewelry_style).toBe(
      'Solitaire',
    )
    expect(photoItemPatch({ ...nothing, style: 'solitaire' }, 'jewelry', 'chain').jewelry_style).toBe(
      'solitaire',
    )
  })

  it('a white piece with no stamp empties the metal: the clerk must pick', () => {
    expect(photoItemPatch({ ...nothing, color: 'White' }, 'jewelry', 'ring').metal_type).toBe('')
    expect(photoItemPatch({ ...nothing, color: 'Silver' }, 'jewelry', 'ring').metal_type).toBe('')
  })

  it('a yellow or rose piece with no stamp leaves the metal as it is', () => {
    expect('metal_type' in photoItemPatch({ ...nothing, color: 'Yellow' }, 'jewelry', 'ring')).toBe(false)
    expect('metal_type' in photoItemPatch({ ...nothing, color: 'Rose' }, 'jewelry', 'ring')).toBe(false)
    expect('metal_type' in photoItemPatch({ ...nothing, color: 'Two-tone' }, 'jewelry', 'ring')).toBe(false)
  })

  it('a stamped white piece takes the stamped metal', () => {
    expect(
      photoItemPatch({ ...nothing, color: 'White', metal_type: 'silver' }, 'jewelry', 'chain').metal_type,
    ).toBe('silver')
  })

  it('drops a karat that cannot be one', () => {
    expect('karat' in photoItemPatch({ ...nothing, karat: 585 }, 'jewelry', 'ring')).toBe(false)
    expect('karat' in photoItemPatch({ ...nothing, karat: 0 }, 'jewelry', 'ring')).toBe(false)
    expect(photoItemPatch({ ...nothing, karat: 18 }, 'jewelry', 'ring').karat).toBe('18')
  })

  it('never takes "none" as a coating it saw', () => {
    expect('coating' in photoItemPatch({ ...nothing, coating: 'none' }, 'jewelry', 'ring')).toBe(false)
    expect(photoItemPatch({ ...nothing, coating: 'gold_plated' }, 'jewelry', 'ring').coating).toBe(
      'gold_plated',
    )
  })

  it('every stone is written as cubic zirconia, with no carats or clarity', () => {
    const patch = photoItemPatch(
      {
        ...nothing,
        stones: [
          { qty: 1, shape: 'round', color: 'clear' },
          { qty: 6.4, shape: 'baguette', color: 'blue' },
          { qty: null, shape: null, color: null },
        ],
        stone_notes: 'Six small stones on the shoulders',
      },
      'jewelry',
      'ring',
    )
    expect(patch.stones).toEqual([
      { qty: '1', type: 'Cubic zirconia', carat: '', color: 'clear', cut: 'round', clarity: '' },
      { qty: '6', type: 'Cubic zirconia', carat: '', color: 'blue', cut: 'baguette', clarity: '' },
    ])
    expect(patch.gemstone_notes).toBe('Six small stones on the shoulders')
  })

  it('a size read off a sizer or ruler goes in Size / Length as a bare number', () => {
    expect(photoItemPatch({ ...nothing, size: '9' }, 'jewelry', 'ring').jewelry_size).toBe('9')
    expect(photoItemPatch({ ...nothing, size: 'size 9.5' }, 'jewelry', 'ring').jewelry_size).toBe('9.5')
    // The description adds "in" itself (lib/pawn/item-description).
    expect(photoItemPatch({ ...nothing, size: '22 in' }, 'jewelry', 'chain').jewelry_size).toBe('22')
    expect(photoItemPatch({ ...nothing, size: '20"' }, 'jewelry', 'chain').jewelry_size).toBe('20')
    // A chain laid folded in half on the tray: twice the reading.
    expect(
      photoItemPatch({ ...nothing, size: '11', folded_in_half: true }, 'jewelry', 'chain').jewelry_size,
    ).toBe('22')
    expect(
      photoItemPatch({ ...nothing, size: '9.5 in', folded_in_half: true }, 'jewelry', 'chain').jewelry_size,
    ).toBe('19')
    expect(
      photoItemPatch({ ...nothing, size: '7.5', folded_in_half: false }, 'jewelry', 'bracelet').jewelry_size,
    ).toBe('7.5')
    // Folded but the reading is not a plain number: left empty, not guessed.
    expect(
      'jewelry_size' in
        photoItemPatch({ ...nothing, size: 'about 11', folded_in_half: true }, 'jewelry', 'chain'),
    ).toBe(false)
    // No tool in the photo: Size is left as the clerk has it.
    expect('jewelry_size' in photoItemPatch(nothing, 'jewelry', 'ring')).toBe(false)
  })

  it('keeps at most six stone lines', () => {
    const stones = Array.from({ length: 9 }, () => ({ qty: 1, shape: 'round', color: 'clear' }))
    expect(photoItemPatch({ ...nothing, stones }, 'jewelry', 'ring').stones).toHaveLength(6)
  })

  it('brand, model and serial go to the jewelry fields', () => {
    expect(
      photoItemPatch({ ...nothing, brand: 'Rolex', model: 'Datejust', serial: 'X123' }, 'jewelry', 'watch'),
    ).toEqual({ jewelry_brand: 'Rolex', jewelry_model: 'Datejust', jewelry_serial: 'X123' })
  })
})

describe('photoItemPatch — weight from a scale in the photo', () => {
  it('takes grams as read', () => {
    expect(
      photoItemPatch({ ...nothing, scale_reading: { value: 12.37, unit: 'g' } }, 'jewelry', 'chain'),
    ).toEqual({ weight_unit: 'g', weight_dwt: '', weight_grams: '12.37' })
  })
  it('keeps pennyweight on screen, grams underneath', () => {
    expect(
      photoItemPatch({ ...nothing, scale_reading: { value: 8.5, unit: 'dwt' } }, 'jewelry', 'chain'),
    ).toEqual({ weight_unit: 'dwt', weight_dwt: '8.5', weight_grams: '13.22' })
  })
  it('turns troy ounces into grams', () => {
    expect(
      photoItemPatch({ ...nothing, scale_reading: { value: 1, unit: 'ozt' } }, 'jewelry', 'coin').weight_grams,
    ).toBe('31.1')
  })
  it('drops a zero, a negative or an impossible reading', () => {
    for (const value of [0, -1.2, 9000]) {
      expect(
        'weight_grams' in photoItemPatch({ ...nothing, scale_reading: { value, unit: 'g' } }, 'jewelry', 'ring'),
      ).toBe(false)
    }
  })
  it('no scale, no weight', () => {
    expect('weight_grams' in photoItemPatch(nothing, 'jewelry', 'ring')).toBe(false)
  })
  it('refuses a unit the popup does not have', () => {
    expect(PhotoItemSchema.safeParse({ ...nothing, scale_reading: { value: 2, unit: 'ct' } }).success).toBe(false)
  })
})

describe('photoItemPatch — everything else', () => {
  it('a firearm', () => {
    expect(
      photoItemPatch(
        {
          ...nothing,
          color: 'black',
          brand: 'Glock',
          model: '19',
          serial: 'ABC123',
          firearm_type: 'handgun',
          firearm_caliber: '9x19',
          firearm_finish: 'black polymer',
          firearm_action: 'semi-automatic',
          firearm_barrels: 1,
          // Not a firearm's: ignored.
          style: 'band',
          karat: 14,
        },
        'firearms',
        'other',
      ),
    ).toEqual({
      color: 'Black',
      firearm_make: 'Glock',
      firearm_model: '19',
      firearm_serial_number: 'ABC123',
      firearm_type: 'handgun',
      firearm_caliber: '9x19',
      firearm_finish: 'black polymer',
      firearm_action_type: 'semi-automatic',
      firearm_number_of_barrels: '1',
    })
  })

  it('electronics, tools and a category of the shop own', () => {
    const seen = { ...nothing, brand: 'DeWalt', model: 'DCD771', serial: 'S1' }
    expect(photoItemPatch(seen, 'electronics', 'electronics')).toEqual({
      electronic_brand: 'DeWalt',
      electronic_model: 'DCD771',
      electronic_serial: 'S1',
    })
    expect(photoItemPatch(seen, 'tools', 'tool')).toEqual({
      tool_brand: 'DeWalt',
      tool_model: 'DCD771',
      tool_serial: 'S1',
    })
    expect(photoItemPatch(seen, 'musical-instruments', 'other')).toEqual({
      general_brand: 'DeWalt',
      general_model: 'DCD771',
      general_serial: 'S1',
    })
  })

  it('the color of a thing that is not jewelry comes from the general list', () => {
    expect(photoItemPatch({ ...nothing, color: 'gray' }, 'tools', 'tool').color).toBe('Gray')
    // "Gray" is not a jewelry color: kept as it came.
    expect(photoItemPatch({ ...nothing, color: 'gray' }, 'jewelry', 'ring').color).toBe('gray')
  })
})

describe('seenCategory', () => {
  const categories = [
    { slug: 'jewelry', subcategories: [{ slug: 'rings' }, { slug: 'chains' }] },
    { slug: 'electronics', subcategories: [{ slug: 'phones' }] },
    { slug: 'general', subcategories: [] },
  ]

  it('a category and one of its own sub-categories', () => {
    expect(seenCategory({ category_slug: 'jewelry', subcategory_slug: 'chains' }, categories)).toEqual({
      top: 'jewelry',
      sub: 'chains',
    })
  })

  it('a category with no sub-categories ignores a sub', () => {
    expect(seenCategory({ category_slug: 'general', subcategory_slug: 'rings' }, categories)).toEqual({
      top: 'general',
      sub: null,
    })
  })

  it('no suggestion for a slug the shop does not have', () => {
    expect(seenCategory({ category_slug: 'boats', subcategory_slug: null }, categories)).toBeNull()
    expect(seenCategory({ category_slug: null, subcategory_slug: null }, categories)).toBeNull()
  })

  it('no suggestion for a sub-category of another category, or a missing one', () => {
    expect(seenCategory({ category_slug: 'jewelry', subcategory_slug: 'phones' }, categories)).toBeNull()
    expect(seenCategory({ category_slug: 'jewelry', subcategory_slug: null }, categories)).toBeNull()
  })
})
