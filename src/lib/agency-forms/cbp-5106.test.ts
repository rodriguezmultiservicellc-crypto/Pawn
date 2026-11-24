import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PDFCheckBox, PDFDocument, PDFDropdown, PDFTextField } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { cbp5106 } from './cbp-5106'
import { hasFact, profileFromTenant, type BusinessProfile } from './profile'
import { answersFor } from './types'

const eddys: BusinessProfile = {
  ...profileFromTenant({
    name: "Eddy's Jewelers Corp.",
    address: '3306 W Columbus Dr',
    city: 'Tampa',
    state: 'Fl',
    zip: '33607',
    phone: '813-876-3119',
    email: 'shop@example.com',
  }),
  ein: '20-5119430',
  mailing_address1: '3414 W St Louis St',
  mailing_type: 'residence',
  physical_same: false,
  physical_address1: '3306 W Columbus Dr',
  physical_city: 'Tampa',
  physical_state: 'FL',
  physical_zip: '33607',
  physical_type: 'retail',
  naics_code: '458310',
  business_description: 'Retail jewelry store and pawnshop; jewelry repair',
  bank_state: 'FL',
  officers: [
    { title: 'President', last_name: 'Rodriguez', first_name: 'Eduardo', middle_initial: '', phone: '', phone_ext: '', email: '', home_address: '' },
  ],
}

const P1 = 'topmostSubform[0].Page1[0].'
const P2 = 'topmostSubform[0].Page2[0].'
const P3 = 'topmostSubform[0].#subform[2].'

describe('CBP 5106 mapping', () => {
  const v = cbp5106.fill(eddys, answersFor(cbp5106, undefined))

  it('fills what the hand-filled form had', () => {
    expect(v.text[P1 + 'Importer[0]']).toBe("Eddy's Jewelers Corp.")
    expect(v.text[P1 + 'SSN[0]']).toBe('205119430')
    expect(v.text[P2 + 'PhoneNumber[0]']).toBe('8138763119')
    expect(v.text[P1 + 'Address[1]']).toBe('3414 W St Louis St')
    expect(v.choices[P1 + 'State[1]']).toBe('Florida')
    expect(v.text[P1 + 'Address[0]']).toBe('3306 W Columbus Dr')
    expect(v.choices[P1 + 'State[0]']).toBe('Florida')
    expect(v.text[P2 + 'Zip[0]']).toBe('33607')
    expect(v.text[P2 + 'CompanyPosition[1]']).toBe('President')
    expect(v.text[P2 + 'Name[2]']).toBe('Rodriguez')
    expect(v.text[P2 + 'Name[3]']).toBe('Eduardo')
    expect(v.text[P3 + 'PrintedName[0]']).toBe('Eduardo Rodriguez, President')
    expect(v.checks).toEqual(
      expect.arrayContaining([
        P1 + 'ActionType[1]', // new
        P1 + 'Company[0]', // corporation
        P1 + 'Entries[0]', // 1-4
        P1 + 'Utilized[4]', // importer of record
        P1 + 'TypeofResidence[0]', // mailing = residence
        P2 + 'TypeofResidence2[0]', // physical = retail
      ]),
    )
  })

  it('leaves 2B empty when the store is the only address', () => {
    const same = cbp5106.fill({ ...eddys, physical_same: true }, answersFor(cbp5106, undefined))
    expect(same.text[P1 + 'Address[0]']).toBeUndefined()
    expect(same.choices[P1 + 'State[0]']).toBeUndefined()
  })

  it('never writes a signature, a date or an SSN of a person', () => {
    const names = [...Object.keys(v.text), ...v.checks, ...Object.keys(v.choices)]
    expect(names.some((n) => /Signature|Date\[|\.SSN\[\d\]$/.test(n) && !n.startsWith(P1 + 'SSN'))).toBe(false)
  })

  it('cuts street lines at 32 characters', () => {
    const long = cbp5106.fill({ ...eddys, mailing_address1: 'x'.repeat(40) }, answersFor(cbp5106, undefined))
    expect(long.text[P1 + 'Address[1]']).toHaveLength(32)
  })

  it('every field it writes is in the blank PDF, with the right kind', async () => {
    const pdf = await PDFDocument.load(readFileSync(path.join(__dirname, 'templates', 'cbp-5106.pdf')))
    const form = pdf.getForm()
    const full: BusinessProfile = {
      ...eddys,
      phone_ext: '1', fax: '1', website: 'x', duns: '1', year_established: 2006,
      mailing_address2: 'x', physical_address2: 'x', bank_name: 'x', bank_routing: '123456789', bank_city: 'x',
      incorporation_state: 'FL', incorporation_number: 'x',
      officers: Array.from({ length: 4 }, (_, i) => ({
        title: 't', last_name: `l${i}`, first_name: 'f', middle_initial: 'M', phone: '1', phone_ext: '1', email: 'e', home_address: '',
      })),
    }
    for (const action of cbp5106.questions[0].options) {
      const all = cbp5106.fill(full, { action, entries: '25+', role: 'consignee' })
      for (const [n, value] of Object.entries(all.text)) {
        const f = form.getField(n)
        expect(f, n).toBeInstanceOf(PDFTextField)
        // Fits the box: the EIN went in as "20-5119430" once and lost a digit.
        const max = (f as PDFTextField).getMaxLength()
        if (max) expect(value.length, `${n} (${value})`).toBeLessThanOrEqual(max)
      }
      for (const n of all.checks) expect(form.getField(n), n).toBeInstanceOf(PDFCheckBox)
      for (const [n, opt] of Object.entries(all.choices)) {
        const f = form.getField(n)
        expect(f, n).toBeInstanceOf(PDFDropdown)
        expect((f as PDFDropdown).getOptions()).toContain(opt)
      }
    }
  })
})

describe('profile facts', () => {
  it('starts from the tenant: name, store address, a corporation by its name', () => {
    const p = profileFromTenant({ name: 'Acme Corp.', address: '1 Main', city: 'Tampa', state: 'Florida', zip: '33601', phone: '1', email: 'a@b.c' })
    expect(p.entity_type).toBe('corporation')
    expect(p.mailing_state).toBe('FL')
    expect(hasFact(p, 'mailing_address')).toBe(true)
    expect(hasFact(p, 'ein')).toBe(false)
    expect(hasFact(p, 'officer')).toBe(false)
  })

  it('a separate physical address must be whole', () => {
    expect(hasFact({ ...eddys, physical_zip: null }, 'physical_address')).toBe(false)
    expect(hasFact(eddys, 'physical_address')).toBe(true)
  })

  it('answers: saved when valid, else the default', () => {
    expect(answersFor(cbp5106, { entries: '5-24', action: 'bogus' })).toEqual({
      action: 'new',
      entries: '5-24',
      role: 'importer_of_record',
    })
  })
})
