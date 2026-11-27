import { describe, expect, it } from 'vitest'
import type { ComplianceLogRow } from '@/types/database-aliases'
import {
  buildLeadsOnlineXml,
  heightText,
  leadsOnlineFilename,
  metalText,
  shopDateTime,
  ticketNumberText,
} from './fl-leadsonline-xml'

/** The element order of an accepted xPawn upload (Dropbox\pawn police,
 *  11172026.xml), one ticket with one item. Typed out here: those files hold
 *  customer data and do not belong in the repo. */
const XPAWN_ORDER = `LeadsOnlineUpload software name version store_info company_nm store_number store_nm store_addr1 store_addr2 store_city store_state store_zip store_county store_phone tickets ticket ticket_type ticket_number enter_date clerk void redeem_date ticket_number_orig enter_date_orig customer cust_nm_last cust_nm_first cust_nm_middle cust_nm_suffix cust_addr1 cust_addr2 cust_city cust_state cust_zip cust_phone cust_id_type cust_id_state cust_id_number cust_id_exp cust_id_type2 cust_id_state2 cust_id_number2 cust_id_exp2 cust_birthdate cust_weight cust_height cust_eye cust_hair cust_race cust_sex cust_info cust_picture cust_picture cust_picture cust_picture employer_nm employer_addr1 employer_addr2 employer_city employer_state employer_zip employer_phone property item item_number item_qty item_make item_model item_serial item_oan item_color item_condition item_desc item_notes item_category item_ncic item_amount item_picture jewelry_style jewelry_metal jewelry_kt jewelry_wt jewelry_size jewelry_sex jewelry_class_nm jewelry_class_yr jewelry_stone1_type jewelry_stone1_color jewelry_stone1_qty jewelry_stone1_shape jewelry_stone1_carat jewelry_stone2_type jewelry_stone2_color jewelry_stone2_qty jewelry_stone2_shape jewelry_stone2_carat firearm_caliber firearm_type firearm_action firearm_finish firearm_barrel`.split(' ')

const store = {
  company: "Eddy's Jewelers",
  storeNumber: '103110000228401',
  address1: '3306 W. Columbus Dr',
  address2: '',
  city: 'Tampa',
  state: 'FL',
  zip: '33607',
  county: '',
  phone: '813-876-3119',
}

const pawn = {
  id: 'r1',
  tenant_id: 't',
  source_table: 'loans',
  source_id: 'loan1',
  event_type: 'pawn_intake',
  occurred_at: '2026-11-24T06:41:09.869Z',
  amount: 65.39,
  reference_number: 'PT-015665',
  clerk: 'ER',
  customer_snapshot: {
    first_name: 'Eddy', last_name: 'Rodriguez', middle_name: 'Didier', date_of_birth: '1979-06-13',
    address1: '3308 W Columbus Dr', city: 'Tampa', state: 'Fl', zip: '33607', phone: '813-647-5237',
    id_type: 'drivers_license', id_state: 'fl', id_number: 'R362204792130', id_expiry: null,
    height_inches: 67, weight_lbs: 190, sex: 'm', race: 'Hispanic', hair_color: 'Black', eye_color: 'Brown',
    place_of_employment: 'Self & Co <LLC>',
  },
  items_snapshot: [
    {
      description: 'signet 14K yellow gold men\'s ring', category: 'ring', pawn_category_slug: 'jewelry',
      pawn_subcategory_slug: 'rings', metal_type: 'gold', color: 'Yellow', karat: 14, weight_grams: 1.2,
      jewelry_size: '8', jewelry_gender: 'men', jewelry_style: 'Signet', est_value: 65.39,
      stones: [{ qty: 5, type: 'Diamond', carat: 0.52, color: 'White', cut: 'Round', clarity: 'VS1' }],
    },
  ],
} as unknown as ComplianceLogRow

const build = (tickets: Array<{ row: ComplianceLogRow; voided: boolean }>) =>
  buildLeadsOnlineXml({
    store,
    tickets,
    timeZone: 'America/New_York',
    software: { name: 'Sol Pawn', version: '0.7.0' },
    ncicBySlug: { rings: 'RING' },
  })

const tagsOf = (xml: string) => [...xml.matchAll(/<([A-Za-z_0-9]+)[\s/>]/g)].map((m) => m[1])
const val = (xml: string, tag: string) => new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml)?.[1]

describe('LeadsOnline XML', () => {
  const xml = build([{ row: pawn, voided: false }])

  it('has the accepted files\' elements, in their order', () => {
    expect(tagsOf(xml)).toEqual(XPAWN_ORDER)
  })

  it('is laid out like them: XML header, tabs, CRLF', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\r\n<LeadsOnlineUpload>\r\n\t<software>')).toBe(true)
    expect(xml).toContain('\t\t\t<redeem_date/>\r\n')
    expect(xml).toContain('\t\t\t\t<cust_picture code="C"/>\r\n')
    expect(xml.endsWith('</LeadsOnlineUpload>\r\n')).toBe(true)
    expect(xml).not.toMatch(/[^\r]\n/)
  })

  it("sends a pawn's redeem-by date (patches/0125), never a buy's", () => {
    const withDate = build([{ row: { ...pawn, redeem_by: '2026-12-25' } as typeof pawn, voided: false }])
    expect(withDate).toContain('\t\t\t<redeem_date>2026-12-25T00:00:00</redeem_date>\r\n')
    expect(tagsOf(withDate)).toEqual(XPAWN_ORDER)
    const buy = build([{ row: { ...pawn, event_type: 'buy_outright', redeem_by: '2026-12-25' } as typeof pawn, voided: false }])
    expect(buy).toContain('\t\t\t<redeem_date/>\r\n')
  })

  it('writes the values the way the accepted files did', () => {
    expect(val(xml, 'store_number')).toBe('103110000228401')
    expect(val(xml, 'store_phone')).toBe('(813) 876-3119')
    expect(val(xml, 'ticket_type')).toBe('2')
    expect(val(xml, 'ticket_number')).toBe('15665')
    expect(val(xml, 'enter_date')).toBe('2026-11-24T01:41:09')
    expect(val(xml, 'clerk')).toBe('ER')
    expect(val(xml, 'void')).toBe('N')
    expect(val(xml, 'cust_state')).toBe('FL')
    expect(val(xml, 'cust_phone')).toBe('8136475237')
    expect(val(xml, 'cust_id_type')).toBe('DL')
    expect(val(xml, 'cust_id_state')).toBe('FL')
    expect(val(xml, 'cust_birthdate')).toBe('1979-06-13T00:00:00')
    expect(val(xml, 'cust_height')).toBe(`5'07"`)
    expect(val(xml, 'cust_race')).toBe('Hispanic')
    expect(val(xml, 'cust_sex')).toBe('M')
    expect(val(xml, 'item_category')).toBe('1')
    expect(val(xml, 'item_ncic')).toBe('RING')
    expect(val(xml, 'item_amount')).toBe('65')
    expect(val(xml, 'jewelry_metal')).toBe('Yellow Gold')
    expect(val(xml, 'jewelry_kt')).toBe('14')
    expect(val(xml, 'jewelry_wt')).toBe('1.2')
    expect(val(xml, 'jewelry_sex')).toBe('M')
    expect(val(xml, 'jewelry_stone1_type')).toBe('Diamond')
    expect(val(xml, 'jewelry_stone1_qty')).toBe('5')
    expect(val(xml, 'jewelry_stone1_shape')).toBe('Round')
    expect(val(xml, 'jewelry_stone2_type')).toBe('')
  })

  it('escapes what XML reserves', () => {
    expect(val(xml, 'employer_nm')).toBe('Self &amp; Co &lt;LLC&gt;')
    expect(val(xml, 'company_nm')).toBe("Eddy's Jewelers")
  })

  it('a voided ticket goes out with void Y', () => {
    expect(val(build([{ row: pawn, voided: true }]), 'void')).toBe('Y')
  })

  it('a buy is ticket type 1, named by its SKU, paid amount per item', () => {
    const buy = {
      ...pawn,
      event_type: 'buy_outright',
      reference_number: 'RNG-AU-003300',
      items_snapshot: [{ description: '10k chain', category: 'chain', metal_type: 'gold', karat: '10K', weight_grams: 5, payout: 120.6, serial_number: '' }],
    } as unknown as ComplianceLogRow
    const b = build([{ row: buy, voided: false }])
    expect(val(b, 'ticket_type')).toBe('1')
    expect(val(b, 'ticket_number')).toBe('RNG-AU-003300')
    expect(val(b, 'item_amount')).toBe('121')
    expect(val(b, 'jewelry_kt')).toBe('10')
    expect(tagsOf(b)).toEqual(XPAWN_ORDER)
  })
})

describe('helpers', () => {
  it('heights', () => {
    expect(heightText(67)).toBe(`5'07"`)
    expect(heightText(72)).toBe(`6'00"`)
    expect(heightText(null)).toBe('')
  })
  it('metals', () => {
    expect(metalText('gold', 'Two-tone')).toBe('Two Tone')
    expect(metalText('white_gold', '')).toBe('White Gold')
    expect(metalText('silver', 'Silver')).toBe('Silver')
    expect(metalText('none', '')).toBe('')
  })
  it('ticket numbers: an imported ticket keeps its number, a new one continues the count', () => {
    expect(ticketNumberText({ event_type: 'pawn_intake', reference_number: '15664' })).toBe('15664')
    expect(ticketNumberText({ event_type: 'pawn_void', reference_number: 'PT-015665' })).toBe('15665')
    // A buy numbered by patches/0115 continues xPawn's buy count; an older one keeps its SKU.
    expect(ticketNumberText({ event_type: 'buy_outright', reference_number: 'BT-021668' })).toBe('21668')
    expect(ticketNumberText({ event_type: 'buy_outright', reference_number: 'INV-000123' })).toBe('INV-000123')
  })
  it('shop time and the file name', () => {
    expect(shopDateTime('2026-07-01T16:30:00Z', 'America/New_York')).toBe('2026-07-01T12:30:00')
    expect(leadsOnlineFilename('103110000228401', new Date('2026-11-24T14:30:49Z'), 'America/New_York')).toBe(
      'h_0_103110000228401_202611240930.xml',
    )
  })
})
