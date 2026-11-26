import { describe, expect, it } from 'vitest'
import {
  isIdAgency,
  isIdExpired,
  missingPledgorFields,
  pledgorColumnsFor,
  parsePledgorIncomplete,
  pledgorIncompleteError,
  type PledgorRecord,
} from './pledgor-record'

const full: PledgorRecord = {
  last_name: 'Rodriguez',
  first_name: 'Eddy',
  address1: '3308 W Columbus Dr',
  city: 'Tampa',
  state: 'FL',
  zip: '33607',
  phone: '8135550100',
  place_of_employment: 'Self-employed',
  date_of_birth: '1979-06-13',
  sex: 'M',
  race: 'Hispanic',
  height_inches: 67,
  weight_lbs: 190,
  hair_color: 'Black',
  eye_color: 'Brown',
  id_type: 'drivers_license',
  id_number: 'R362204792130',
  id_state: 'FL',
  id_expiry: '2030-06-13',
}

const TODAY = '2026-11-25'

describe('missingPledgorFields', () => {
  it('nothing missing on a full record', () => {
    expect(missingPledgorFields(full, TODAY)).toEqual([])
  })

  it('PT-015665: eyes, race and employment empty, a date as the ID agency', () => {
    expect(
      missingPledgorFields({ ...full, eye_color: null, race: null, place_of_employment: null, id_state: '01/01/2001' }, TODAY),
    ).toEqual(['place_of_employment', 'race', 'eye_color', 'id_state'])
  })

  it('blank text and a zero height count as missing', () => {
    expect(missingPledgorFields({ ...full, phone: '  ', height_inches: 0 }, TODAY)).toEqual(['phone', 'height_inches'])
  })

  it('the address needs street, city, state and zip', () => {
    expect(missingPledgorFields({ ...full, zip: null }, TODAY)).toEqual(['address'])
  })
})

describe('an expired ID', () => {
  it('is refused like a missing field', () => {
    expect(missingPledgorFields({ ...full, id_expiry: '2026-11-24' }, TODAY)).toEqual(['id_expiry'])
  })
  it('expiring today is still good; no expiry on file is refused too', () => {
    expect(missingPledgorFields({ ...full, id_expiry: TODAY }, TODAY)).toEqual([])
    expect(missingPledgorFields({ ...full, id_expiry: null }, TODAY)).toEqual(['id_expiry'])
    expect(missingPledgorFields({ ...full, id_expiry: ' ' }, TODAY)).toEqual(['id_expiry'])
    expect(isIdExpired('2026-11-24T00:00:00', TODAY)).toBe(true)
  })
  it('the popup takes the new ID: number, expiry and agency, once each', () => {
    expect(pledgorColumnsFor(['id_number', 'id_expiry'])).toEqual(['id_number', 'id_expiry', 'id_state'])
  })
})

describe('isIdAgency', () => {
  it('a state or an office', () => {
    expect(isIdAgency('FL')).toBe(true)
    expect(isIdAgency('U.S. Department of State')).toBe(true)
  })
  it('never a date, a number or nothing', () => {
    expect(isIdAgency('01/01/2001')).toBe(false)
    expect(isIdAgency('2001')).toBe(false)
    expect(isIdAgency('')).toBe(false)
    expect(isIdAgency(null)).toBe(false)
  })
})

describe('the error code', () => {
  it('round-trips the missing fields', () => {
    expect(parsePledgorIncomplete(pledgorIncompleteError(['race', 'eye_color']))).toEqual(['race', 'eye_color'])
  })
  it('ignores other errors and unknown keys', () => {
    expect(parsePledgorIncomplete('customer_not_found')).toBeNull()
    expect(parsePledgorIncomplete('pledgor_incomplete:race,bogus')).toEqual(['race'])
  })
})
