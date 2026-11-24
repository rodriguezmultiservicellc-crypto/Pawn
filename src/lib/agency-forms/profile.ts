/**
 * The shop's business profile (tenant_business_profile, patches/0110): the
 * facts agency forms keep asking for. Pure; shared by the profile page, the
 * forms and their tests.
 */

import { stateCode } from './us-states'

export const ENTITY_TYPES = ['corporation', 'llc', 'partnership', 'sole_proprietorship', 'individual'] as const
export type EntityType = (typeof ENTITY_TYPES)[number]

/** What kind of place an address is (the CBP 5106 list; others map to it). */
export const ADDRESS_TYPES = [
  'retail',
  'residence',
  'corporate_office',
  'office_building',
  'warehouse',
  'business_service_center',
  'po_box',
] as const
export type AddressType = (typeof ADDRESS_TYPES)[number]

export type Officer = {
  title: string
  last_name: string
  first_name: string
  middle_initial: string
  phone: string
  phone_ext: string
  email: string
  home_address: string
}

export type BusinessProfile = {
  legal_name: string | null
  ein: string | null
  entity_type: EntityType | null
  incorporation_state: string | null
  incorporation_number: string | null
  year_established: number | null
  naics_code: string | null
  business_description: string | null
  duns: string | null
  phone: string | null
  phone_ext: string | null
  fax: string | null
  email: string | null
  website: string | null
  mailing_address1: string | null
  mailing_address2: string | null
  mailing_city: string | null
  mailing_state: string | null
  mailing_zip: string | null
  mailing_type: AddressType | null
  physical_same: boolean
  physical_address1: string | null
  physical_address2: string | null
  physical_city: string | null
  physical_state: string | null
  physical_zip: string | null
  physical_type: AddressType | null
  bank_name: string | null
  bank_routing: string | null
  bank_city: string | null
  bank_state: string | null
  officers: Officer[]
  form_answers: Record<string, Record<string, string>>
}

export const PROFILE_COLUMNS =
  'legal_name, ein, entity_type, incorporation_state, incorporation_number, year_established, naics_code, business_description, duns, phone, phone_ext, fax, email, website, mailing_address1, mailing_address2, mailing_city, mailing_state, mailing_zip, mailing_type, physical_same, physical_address1, physical_address2, physical_city, physical_state, physical_zip, physical_type, bank_name, bank_routing, bank_city, bank_state, officers, form_answers'

export const BLANK_OFFICER: Officer = {
  title: '',
  last_name: '',
  first_name: '',
  middle_initial: '',
  phone: '',
  phone_ext: '',
  email: '',
  home_address: '',
}

/** Read the officers JSONB defensively: anything not an object is dropped. */
export function normalizeOfficers(v: unknown): Officer[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object')
    .map((o) => {
      const s = (k: keyof Officer) => (typeof o[k] === 'string' ? (o[k] as string).trim() : '')
      return {
        title: s('title'),
        last_name: s('last_name'),
        first_name: s('first_name'),
        middle_initial: s('middle_initial').slice(0, 1).toUpperCase(),
        phone: s('phone'),
        phone_ext: s('phone_ext'),
        email: s('email'),
        home_address: s('home_address'),
      }
    })
}

type TenantFacts = {
  name: string
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  phone: string | null
  email: string | null
}

const clean = (v: string | null | undefined) => {
  const s = (v ?? '').trim()
  return s ? s : null
}

/**
 * A profile with nothing saved yet starts from what Pawn already knows of
 * the shop (tenants): name, the store's address as both mailing and
 * physical, phone, email.
 */
export function profileFromTenant(t: TenantFacts): BusinessProfile {
  return {
    legal_name: clean(t.name),
    ein: null,
    entity_type: /\b(corp|corporation|inc|incorporated)\b\.?/i.test(t.name) ? 'corporation' : /\bllc\b/i.test(t.name) ? 'llc' : null,
    incorporation_state: null,
    incorporation_number: null,
    year_established: null,
    naics_code: null,
    business_description: null,
    duns: null,
    phone: clean(t.phone),
    phone_ext: null,
    fax: null,
    email: clean(t.email),
    website: null,
    mailing_address1: clean(t.address),
    mailing_address2: null,
    mailing_city: clean(t.city),
    mailing_state: stateCode(t.state),
    mailing_zip: clean(t.zip),
    mailing_type: 'retail',
    physical_same: true,
    physical_address1: null,
    physical_address2: null,
    physical_city: null,
    physical_state: null,
    physical_zip: null,
    physical_type: null,
    bank_name: null,
    bank_routing: null,
    bank_city: null,
    bank_state: null,
    officers: [],
    form_answers: {},
  }
}

/** Every profile fact a form can require, for the "still missing" list. */
export type ProfileFact =
  | 'legal_name'
  | 'ein'
  | 'entity_type'
  | 'mailing_address'
  | 'mailing_type'
  | 'physical_address'
  | 'phone'
  | 'email'
  | 'officer'

const has = (v: string | null | undefined) => !!v && v.trim() !== ''

/** Whether the profile holds a fact (a whole address counts as one). */
export function hasFact(p: BusinessProfile, f: ProfileFact): boolean {
  switch (f) {
    case 'legal_name': return has(p.legal_name)
    case 'ein': return has(p.ein)
    case 'entity_type': return !!p.entity_type
    case 'mailing_address':
      return has(p.mailing_address1) && has(p.mailing_city) && has(p.mailing_state) && has(p.mailing_zip)
    case 'mailing_type': return !!p.mailing_type
    case 'physical_address':
      return p.physical_same ||
        (has(p.physical_address1) && has(p.physical_city) && has(p.physical_state) && has(p.physical_zip) && !!p.physical_type)
    case 'phone': return has(p.phone)
    case 'email': return has(p.email)
    case 'officer': return p.officers.some((o) => has(o.last_name) && has(o.first_name) && has(o.title))
  }
}
