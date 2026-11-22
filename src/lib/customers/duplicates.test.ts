import { describe, expect, it } from 'vitest'
import { findDuplicateGroups, normName, normPhone, type DuplicateCandidate } from './duplicates'

let n = 0
function c(over: Partial<DuplicateCandidate>): DuplicateCandidate {
  n += 1
  return {
    id: `c${n}`,
    first_name: 'Ana',
    last_name: 'Diaz',
    phone: null,
    phone_alt: null,
    email: null,
    id_number: null,
    date_of_birth: null,
    created_at: `2026-01-${String(n).padStart(2, '0')}`,
    ...over,
  }
}

describe('normalizers', () => {
  it('folds accents, case and punctuation in names', () => {
    expect(normName('José ', "O'Neil")).toBe('jose o neil')
  })
  it('keeps the last 10 phone digits and drops short ones', () => {
    expect(normPhone('+1 (813) 679-9772')).toBe('8136799772')
    expect(normPhone('12345')).toBe('')
  })
})

describe('findDuplicateGroups', () => {
  it('pairs records sharing an ID number even with different phones', () => {
    const a = c({ first_name: 'Eddy', last_name: 'Rodriguez', id_number: 'R362-204-79-213-0', phone: '8136475237' })
    const b = c({ first_name: 'Eddy', last_name: 'Rodriguez', id_number: 'R362204792130', phone: '(813) 679-9772' })
    const groups = findDuplicateGroups([a, b, c({ id_number: 'X1' })])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.signal).toBe('id_number')
    expect(groups[0]!.customers.map((x) => x.id)).toEqual([a.id, b.id])
  })

  it('matches name + phone across the phone and alternate-phone slots', () => {
    const a = c({ phone: '813-555-0101' })
    const b = c({ first_name: 'ANA', phone: '813 555 9999', phone_alt: '(813) 555-0101' })
    expect(findDuplicateGroups([a, b])[0]?.signal).toBe('name_phone')
  })

  it('never groups on name alone', () => {
    expect(findDuplicateGroups([c({}), c({})])).toEqual([])
  })

  it('does not group same phone with different names', () => {
    expect(findDuplicateGroups([c({ phone: '8135550101' }), c({ first_name: 'Luis', phone: '8135550101' })])).toEqual([])
  })

  it('reports a pair once, under the strongest signal', () => {
    const a = c({ id_number: 'ABC12345', phone: '8135550101', date_of_birth: '1980-01-01' })
    const b = c({ id_number: 'ABC12345', phone: '8135550101', date_of_birth: '1980-01-01' })
    const groups = findDuplicateGroups([a, b])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.signal).toBe('id_number')
  })
})
