/**
 * CBP Form 5106 — Create/Update Importer Identity Form (19 CFR 24.5),
 * edition 12/18. Field names are the PDF's own (an XFA form with AcroForm
 * fields); each was matched to its box by position on the page.
 *
 * Never filled: the signature and its date (the signer's), Social Security
 * and passport numbers (optional, never stored), 1E / 1F (CBP-assigned
 * number: the EIN is the importer number), 1J-1M program codes, 3D filer
 * code, 3F related businesses, broker block.
 */

import type { AddressType, BusinessProfile, EntityType, Officer } from './profile'
import type { AgencyFormDef, PdfFieldValues } from './types'
import { stateName } from './us-states'

const P1 = 'topmostSubform[0].Page1[0].'
const P2 = 'topmostSubform[0].Page2[0].'
const P3 = 'topmostSubform[0].#subform[2].'

const ACTION: Record<string, string> = {
  new: P1 + 'ActionType[1]',
  name_change: P1 + 'ActionType[2]',
  address_change: P1 + 'ActionType[0]',
}

const COMPANY: Record<EntityType, string> = {
  corporation: P1 + 'Company[0]',
  partnership: P1 + 'Company[1]',
  llc: P1 + 'Company[2]',
  sole_proprietorship: P1 + 'Company[3]',
  individual: P1 + 'Company[7]',
}

const ENTRIES: Record<string, string> = {
  '1-4': P1 + 'Entries[0]',
  '5-24': P1 + 'Entries[1]',
  '25+': P1 + 'Entries[2]',
  personal: P1 + 'Entries[3]',
  none: P1 + 'Entries[4]',
}

const ROLE: Record<string, string> = {
  importer_of_record: P1 + 'Utilized[4]',
  consignee: P1 + 'Utilized[0]',
}

/** 2A's address-type boxes. */
const MAILING_TYPE: Record<AddressType, string> = {
  residence: P1 + 'TypeofResidence[0]',
  corporate_office: P1 + 'TypeofResidence[1]',
  warehouse: P1 + 'TypeofResidence[2]',
  retail: P1 + 'TypeofResidence[7]',
  office_building: P1 + 'TypeofResidence[3]',
  business_service_center: P1 + 'TypeofResidence[4]',
  po_box: P1 + 'TypeofResidence[5]',
}

/** 2B's (a physical location is never a P.O. box or a service center). */
const PHYSICAL_TYPE: Partial<Record<AddressType, string>> = {
  residence: P2 + 'TypeofResidence2[5]',
  corporate_office: P2 + 'TypeofResidence2[4]',
  warehouse: P2 + 'TypeofResidence2[3]',
  retail: P2 + 'TypeofResidence2[0]',
  office_building: P2 + 'TypeofResidence2[2]',
}

/** The four officer blocks of 3J, in the order they print. */
const OFFICER_SLOTS = [
  { p: P2, title: 'CompanyPosition[1]', last: 'Name[2]', first: 'Name[3]', mi: 'Name[4]', phone: 'DirectPhoneNumber[1]', ext: 'DirectExtension[0]', email: 'DirectEmail[1]' },
  { p: P2, title: 'CompanyPosition[0]', last: 'Name[1]', first: 'Name[5]', mi: 'Name[6]', phone: 'DirectPhoneNumber[0]', ext: 'DirectExtension[1]', email: 'DirectEmail[0]' },
  { p: P3, title: 'CompanyPosition[1]', last: 'Name[3]', first: 'Name[4]', mi: 'Name[5]', phone: 'DirectPhoneNumber[1]', ext: 'DirectExtension[1]', email: 'DirectEmail[1]' },
  { p: P3, title: 'CompanyPosition[0]', last: 'Name[0]', first: 'Name[1]', mi: 'Name[2]', phone: 'DirectPhoneNumber[0]', ext: 'DirectExtension[0]', email: 'DirectEmail[0]' },
] as const

/** Street lines on this form are limited to 32 characters. */
const street = (v: string | null) => (v ?? '').trim().slice(0, 32)

/** The number boxes (EIN 9, phone / fax 10, ZIP 5, routing 9) take digits
 *  only: "20-5119430" would not fit and would lose its last digit. */
const num = (v: string | number | null | undefined) => String(v ?? '').replace(/\D/g, '')
/** A ZIP box holds the five-digit ZIP (ZIP+4 loses the +4). */
const zip5 = (v: string | null) => num(v).slice(0, 5)

function put(out: PdfFieldValues, name: string, v: string | number | null | undefined) {
  const s = v == null ? '' : String(v).trim()
  if (s) out.text[name] = s
}

export const cbp5106: AgencyFormDef = {
  id: 'cbp-5106',
  template: 'cbp-5106.pdf',
  agency: 'U.S. Customs and Border Protection',
  code: 'CBP Form 5106',
  questions: [
    { key: 'action', options: ['new', 'name_change', 'address_change'], default: 'new' },
    { key: 'entries', options: ['1-4', '5-24', '25+', 'personal', 'none'], default: '1-4' },
    { key: 'role', options: ['importer_of_record', 'consignee'], default: 'importer_of_record' },
  ],
  required: ['legal_name', 'ein', 'entity_type', 'mailing_address', 'mailing_type', 'physical_address', 'phone', 'email', 'officer'],

  fill(p: BusinessProfile, a: Record<string, string>): PdfFieldValues {
    const out: PdfFieldValues = { text: {}, checks: [], choices: {} }
    const tick = (name: string | undefined) => {
      if (name) out.checks.push(name)
    }

    tick(ACTION[a.action])
    put(out, P1 + 'Importer[0]', p.legal_name)
    put(out, P1 + 'SSN[0]', num(p.ein))
    if (p.entity_type) tick(COMPANY[p.entity_type])
    tick(ENTRIES[a.entries])
    tick(ROLE[a.role])

    // 2A mailing address
    put(out, P1 + 'Address[1]', street(p.mailing_address1))
    put(out, P1 + 'Address[2]', street(p.mailing_address2))
    put(out, P1 + 'City[1]', p.mailing_city)
    if (stateName(p.mailing_state)) out.choices[P1 + 'State[1]'] = stateName(p.mailing_state)
    put(out, P1 + 'Zip[0]', zip5(p.mailing_zip))
    if (p.mailing_type) tick(MAILING_TYPE[p.mailing_type])

    // 2B physical location — only when it differs from 2A
    if (!p.physical_same) {
      put(out, P1 + 'Address[0]', street(p.physical_address1))
      put(out, P2 + 'Address[0]', street(p.physical_address2))
      put(out, P1 + 'City[0]', p.physical_city)
      if (stateName(p.physical_state)) out.choices[P1 + 'State[0]'] = stateName(p.physical_state)
      put(out, P2 + 'Zip[0]', zip5(p.physical_zip))
      if (p.physical_type) tick(PHYSICAL_TYPE[p.physical_type])
    }

    put(out, P2 + 'PhoneNumber[0]', num(p.phone))
    put(out, P2 + 'Extension[0]', p.phone_ext)
    put(out, P2 + 'FaxNumber[0]', num(p.fax))
    put(out, P2 + 'Email[0]', p.email)
    put(out, P2 + 'Website[0]', p.website)

    // 3 company information
    put(out, P2 + 'BusinessDescription[0]', p.business_description)
    put(out, P2 + 'NAICSCode[0]', num(p.naics_code))
    put(out, P2 + 'DUNSNumber[0]', p.duns)
    put(out, P2 + 'Year[0]', p.year_established)
    put(out, P2 + 'Name[0]', p.bank_name)
    put(out, P2 + 'BankRoutingNumber[0]', num(p.bank_routing))
    put(out, P2 + 'City[0]', p.bank_city)
    if (stateName(p.bank_state)) out.choices[P2 + 'State[0]'] = stateName(p.bank_state)
    put(out, P2 + 'LocatorID[0]', p.incorporation_state)
    put(out, P2 + 'ReferenceNumber[0]', p.incorporation_number)

    // 3J officers (up to four)
    const officers = p.officers.filter((o) => o.last_name || o.first_name)
    officers.slice(0, OFFICER_SLOTS.length).forEach((o: Officer, i) => {
      const s = OFFICER_SLOTS[i]
      put(out, s.p + s.title, o.title)
      put(out, s.p + s.last, o.last_name)
      put(out, s.p + s.first, o.first_name)
      put(out, s.p + s.mi, o.middle_initial)
      put(out, s.p + s.phone, num(o.phone))
      put(out, s.p + s.ext, o.phone_ext)
      put(out, s.p + s.email, o.email)
    })

    // 4 certification: the first officer signs; signature and date are theirs
    const signer = officers[0]
    if (signer) {
      const name = [signer.first_name, signer.middle_initial ? `${signer.middle_initial}.` : '', signer.last_name]
        .filter(Boolean)
        .join(' ')
      put(out, P3 + 'PrintedName[0]', signer.title ? `${name}, ${signer.title}` : name)
      put(out, P3 + 'PhoneNumber[0]', num(signer.phone))
    }

    return out
  },
}
