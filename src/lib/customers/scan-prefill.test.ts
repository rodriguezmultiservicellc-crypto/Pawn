import { describe, expect, it } from 'vitest'
import { scanFields } from './scan-prefill'
import type { DLInfo } from '@/lib/dl-parser'

function info(over: Partial<DLInfo> = {}): DLInfo {
  return {
    lastName: '', firstName: '', middleName: '', suffix: '', dob: '',
    expirationDate: '', issuedDate: '', gender: '', address: '', city: '',
    state: '', zip: '', height: '', licenseNumber: '', auditInfo: '',
    realIdCompliant: false,
    ...over,
  }
}

describe('scanFields', () => {
  it('maps a full license onto customer fields', () => {
    expect(
      scanFields(
        info({
          firstName: 'ANA', middleName: 'M', lastName: 'DIAZ', dob: '1990-02-03',
          gender: 'F', address: '1 MAIN ST', city: 'TAMPA', state: 'FL', zip: '33601',
          licenseNumber: 'D123', expirationDate: '2030-01-01', height: '065 in',
        }),
      ),
    ).toEqual({
      first_name: 'ANA', middle_name: 'M', last_name: 'DIAZ', date_of_birth: '1990-02-03',
      sex: 'F', address1: '1 MAIN ST', city: 'TAMPA', state: 'FL', id_state: 'FL',
      zip: '33601', id_number: 'D123', id_expiry: '2030-01-01', height_inches: 65,
      id_type: 'drivers_license', id_country: 'US',
    })
  })

  it('leaves out what the license did not carry', () => {
    expect(scanFields(info({ licenseNumber: 'X9' }))).toEqual({
      id_number: 'X9', id_type: 'drivers_license', id_country: 'US',
    })
  })

  it('turns centimeters into inches', () => {
    expect(scanFields(info({ height: '180 cm' })).height_inches).toBe(71)
  })
})
