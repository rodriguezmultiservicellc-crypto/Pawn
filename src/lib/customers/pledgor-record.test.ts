import { describe, expect, it } from 'vitest'
import {
  isIdAgency,
  missingPledgorFields,
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
}

describe('missingPledgorFields', () => {
  it('nothing missing on a full record', () => {
    expect(missingPledgorFields(full)).toEqual([])
  })

  it('PT-015665: eyes, race and employment empty, a date as the ID agency', () => {
    expect(
      missingPledgorFields({ ...full, eye_color: null, race: null, place_of_employment: null, id_state: '01/01/2001' }),
    ).toEqual(['place_of_employment', 'race', 'eye_color', 'id_state'])
  })

  it('blank text and a zero height count as missing', () => {
    expect(missingPledgorFields({ ...full, phone: '  ', height_inches: 0 })).toEqual(['phone', 'height_inches'])
  })

  it('the address needs street, city, state and zip', () => {
    expect(missingPledgorFields({ ...full, zip: null })).toEqual(['address'])
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
