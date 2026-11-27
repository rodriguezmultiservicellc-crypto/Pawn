import { describe, expect, it } from 'vitest'
import type { ComplianceLogRow } from '@/types/database-aliases'
import {
  apiDateTime,
  checkDoNotBuy2Envelope,
  checkLoginEnvelope,
  imageTypeOfPath,
  itemPhotoPaths,
  parseDoNotBuy,
  parseResponse,
  submitTransactionEnvelope,
  ticketFromComplianceRow,
  updateTransactionEnvelope,
} from './soap'

const login = { storeId: 57434, userName: 'eddystest01', password: 'p<w>&"' }

function row(over: Partial<ComplianceLogRow> = {}): ComplianceLogRow {
  return {
    id: 'c1',
    tenant_id: 't1',
    source_table: 'loans',
    source_id: 'loan1',
    event_type: 'pawn_intake',
    occurred_at: '2026-11-27T19:05:00.000Z',
    created_at: '2026-11-27T19:05:00.000Z',
    reference_number: 'PT-015665',
    clerk: 'JG',
    amount: 300,
    exported_at: null,
    exported_batch_id: null,
    exported_format: null,
    export_outcome: null,
    customer_snapshot: {
      id: 'cust1',
      first_name: 'Frank',
      last_name: 'Furter',
      middle_name: 'Q',
      date_of_birth: '1971-01-01',
      phone: '(813) 555-1212',
      address1: '1 Main St',
      city: 'Tampa',
      state: 'fl',
      zip: '33602',
      id_type: 'drivers_license',
      id_number: 'F123',
      id_state: 'fl',
      id_expiry: '2030-01-01',
      height_inches: 70,
      weight_lbs: 180,
      sex: 'male',
      race: 'White',
      hair_color: 'Brown',
      eye_color: 'Blue',
    },
    items_snapshot: [
      {
        category: 'ring',
        pawn_category_slug: 'jewelry',
        description: '14K yellow gold ring',
        metal_type: 'gold',
        color: 'yellow',
        karat: 14,
        weight_grams: 4.256,
        est_value: 450,
        photo_path: 't1/intake/a.jpg',
        extra_photo_paths: ['t1/intake/b.webp'],
      },
    ],
    ...over,
  } as ComplianceLogRow
}

describe('apiDateTime', () => {
  it('writes the shop wall clock as MM/DD/YYYY HH:MM', () => {
    expect(apiDateTime('2026-11-27T19:05:00.000Z', 'America/New_York')).toBe('11/27/2026 14:05')
  })
})

describe('ticketFromComplianceRow', () => {
  it('builds a pawn ticket from the snapshot', () => {
    const t = ticketFromComplianceRow({ row: row(), voided: false, timeZone: 'America/New_York', ncicBySlug: { jewelry: 'JEWL' } })
    expect(t.key).toEqual({ ticketType: 'Pawn', ticketnumber: '15665', ticketDateTime: '11/27/2026 14:05' })
    expect(t.customer).toMatchObject({ fname: 'Frank', lname: 'Furter', state: 'FL', phone: '813-555-1212', idType: 'DL', dob: '1971-01-01', height: 70, weight: 180, sex: 'M' })
    expect(t.customer.extra).toContainEqual({ name: 'CUSTOMER_ID_ISSUER1', value: 'FL' })
    const item = t.items[0]
    expect(item).toMatchObject({ itemType: 'Jewelry', itemStatus: 'Pawn', amount: 450, employee: 'JG', isVoid: false })
    expect(item.extra).toEqual(
      expect.arrayContaining([
        { name: 'STORE_NCIC_CODE', value: 'JEWL' },
        { name: 'JEWELRY_METAL', value: 'Yellow Gold' },
        { name: 'JEWELRY_KARAT', value: '14' },
        { name: 'JEWELRY_WEIGHT', value: '4.26' },
        { name: 'JEWELRY_WEIGHT_UNIT', value: 'grams' },
      ]),
    )
    expect(t.extra).toEqual([{ name: 'TICKET_LOAN_AMOUNT', value: '300' }])
  })

  it('marks a voided ticket and every item void', () => {
    const t = ticketFromComplianceRow({ row: row(), voided: true, timeZone: 'America/New_York' })
    expect(t.isVoid).toBe(true)
    expect(t.items.every((i) => i.isVoid)).toBe(true)
  })

  it('sends a buy as Buy with the price paid', () => {
    const t = ticketFromComplianceRow({
      row: row({
        event_type: 'buy_outright',
        reference_number: 'BT-021668',
        items_snapshot: [{ description: 'Ring', payout: 120, est_value: 999, category: 'ring' }],
      }),
      voided: false,
      timeZone: 'America/New_York',
    })
    expect(t.key.ticketType).toBe('Buy')
    expect(t.key.ticketnumber).toBe('21668')
    expect(t.items[0]).toMatchObject({ itemStatus: 'Buy', amount: 120 })
  })

  it('leaves silver karat out (rule 31)', () => {
    const t = ticketFromComplianceRow({
      row: row({ items_snapshot: [{ category: 'ring', description: 'Silver ring', metal_type: 'silver', karat: 925 }] }),
      voided: false,
      timeZone: 'America/New_York',
    })
    expect(t.items[0].extra.find((p) => p.name === 'JEWELRY_KARAT')).toBeUndefined()
  })
})

describe('envelopes', () => {
  it('CheckLogin: ApiVersion first, password escaped', () => {
    const x = checkLoginEnvelope(login)
    expect(x).toContain('<CheckLogin xmlns="http://www.leadsonline.com/"><ApiVersion xsi:nil="true"/><login><storeId>57434</storeId>')
    expect(x).toContain('<password>p&lt;w&gt;&amp;&quot;</password>')
  })

  it('SubmitTransaction: WSDL order key, customer, items, isVoid', () => {
    const t = ticketFromComplianceRow({ row: row(), voided: false, timeZone: 'America/New_York' })
    const x = submitTransactionEnvelope(login, t)
    const at = (s: string) => x.indexOf(s)
    expect(at('<ApiVersion')).toBeLessThan(at('<login>'))
    expect(at('<login>')).toBeLessThan(at('<ticket>'))
    expect(at('<key>')).toBeLessThan(at('<customer>'))
    expect(at('<customer>')).toBeLessThan(at('<items>'))
    expect(at('<weight>180</weight>')).toBeLessThan(at('<height>70</height>'))
    expect(at('<amount>450.00</amount>')).toBeLessThan(at('<itemType>Jewelry</itemType>'))
    expect(at('</items><isVoid>false</isVoid><extraTicket>')).toBeGreaterThan(0)
    expect(x).toContain('</extraTicket></ticket></SubmitTransaction>')
  })

  it('UpdateTransaction carries the old key', () => {
    const t = ticketFromComplianceRow({ row: row(), voided: true, timeZone: 'America/New_York' })
    const x = updateTransactionEnvelope(login, t.key, t)
    expect(x).toContain('<oldTicket><ticketType>Pawn</ticketType><ticketnumber>15665</ticketnumber>')
    expect(x.indexOf('<oldTicket>')).toBeLessThan(x.indexOf('<ticket>'))
  })

  it('CheckDoNotBuy2 in WSDL order: BirthDate, ID, Name, login', () => {
    const x = checkDoNotBuy2Envelope(login, { id: '66778855', name: 'FRANK FURTER', birthDate: '01/01/1971' })
    expect(x).toContain('<ApiVersion xsi:nil="true"/><BirthDate>01/01/1971</BirthDate><ID>66778855</ID><Name>FRANK FURTER</Name><login>')
  })
})

describe('responses', () => {
  it('reads a Response', () => {
    const xml =
      '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><CheckLoginResponse xmlns="http://www.leadsonline.com/"><CheckLoginResult><errorCode>4</errorCode><errorResponse>Username and password are not both specified.</errorResponse></CheckLoginResult></CheckLoginResponse></s:Body></s:Envelope>'
    expect(parseResponse(xml)).toEqual({ kind: 'response', errorCode: 4, errorResponse: 'Username and password are not both specified.' })
  })

  it('reads success with an empty errorResponse', () => {
    expect(parseResponse('<r><errorCode>0</errorCode><errorResponse /></r>')).toEqual({ kind: 'response', errorCode: 0, errorResponse: '' })
  })

  it('reads a SOAP fault', () => {
    expect(parseResponse('<s:Envelope><s:Body><s:Fault><faultcode>s:Client</faultcode><faultstring>Bad &amp; wrong</faultstring></s:Fault></s:Body></s:Envelope>')).toEqual({
      kind: 'fault',
      message: 'Bad & wrong',
    })
  })

  it('reads Do Not Buy hits', () => {
    const xml =
      '<CheckDoNotBuy2Result><DoNotBuyInfo><agency>Tampa PD</agency><ID>66778855</ID><state>FL</state><name>FRANK FURTER</name><dob>01/01/1971</dob><contactName>Det. X</contactName><contactNumber>813</contactNumber></DoNotBuyInfo></CheckDoNotBuy2Result>'
    const r = parseDoNotBuy(xml)
    expect(r.kind === 'hits' && r.hits).toEqual([
      { agency: 'Tampa PD', ID: '66778855', state: 'FL', name: 'FRANK FURTER', dob: '01/01/1971', contactName: 'Det. X', contactNumber: '813' },
    ])
    expect(parseDoNotBuy('<CheckDoNotBuy2Result />')).toEqual({ kind: 'hits', hits: [] })
  })
})

describe('images', () => {
  it('takes jpeg / png / gif / pdf only', () => {
    expect(imageTypeOfPath('a/b.JPG')).toBe('Jpeg')
    expect(imageTypeOfPath('a/b.png')).toBe('Png')
    expect(imageTypeOfPath('a/b.webp')).toBeNull()
    expect(imageTypeOfPath('a/b.heic')).toBeNull()
  })

  it('lists every photo of an item once, main first', () => {
    expect(itemPhotoPaths({ photo_path: 'a.jpg', extra_photo_paths: ['b.jpg'], photo_paths: ['a.jpg', 'c.jpg'] })).toEqual(['a.jpg', 'b.jpg', 'c.jpg'])
  })
})
