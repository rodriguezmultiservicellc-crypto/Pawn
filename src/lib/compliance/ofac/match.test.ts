import { describe, expect, it } from 'vitest'
import {
  dobConflicts,
  dobYears,
  evaluateCandidates,
  jaroWinkler,
  nameTokens,
  normalizeForIndex,
  parseSdnFeed,
  scoreName,
} from './match'
import { parseCsvGrid } from '@/lib/imports/csv'

describe('nameTokens / normalizeForIndex', () => {
  it('strips accents, punctuation, particles and honorifics', () => {
    expect(nameTokens('José de la Peña-Ruíz')).toEqual(['JOSE', 'PENA', 'RUIZ'])
    expect(nameTokens('AL ZAWAHIRI, Dr. Ayman')).toEqual(['ZAWAHIRI', 'AYMAN'])
  })
  it('index form is order-independent', () => {
    expect(normalizeForIndex('ABBAS, Abu')).toBe(normalizeForIndex('Abu Abbas'))
  })
})

describe('jaroWinkler', () => {
  it('matches known reference values', () => {
    expect(jaroWinkler('MARTHA', 'MARHTA')).toBeCloseTo(0.9611, 3)
    expect(jaroWinkler('DWAYNE', 'DUANE')).toBeCloseTo(0.84, 2)
    expect(jaroWinkler('ABC', 'ABC')).toBe(1)
    expect(jaroWinkler('ABC', 'XYZ')).toBe(0)
  })
})

describe('scoreName', () => {
  it('scores exact reordered names at 1', () => {
    expect(scoreName({ firstName: 'Ayman', lastName: 'Al Zawahiri' }, 'AL ZAWAHIRI, Dr. Ayman')).toBe(1)
  })
  it('tolerates a one-letter typo', () => {
    expect(scoreName({ firstName: 'Aiman', lastName: 'Zawahiri' }, 'AL ZAWAHIRI, Ayman')).toBeGreaterThan(0.9)
  })
  it('rejects when a required token has no counterpart', () => {
    expect(scoreName({ firstName: 'Maria', lastName: 'Zawahiri' }, 'AL ZAWAHIRI, Ayman')).toBe(0)
  })
  it('does not let one SDN token satisfy two customer tokens', () => {
    expect(scoreName({ firstName: 'Jose', lastName: 'Jose' }, 'RAMIREZ, Jose')).toBe(0)
  })
  it('still flags a name covering two of three SDN tokens', () => {
    expect(scoreName({ firstName: 'Juan', lastName: 'Perez' }, 'PEREZ, Juan Carlos')).toBeGreaterThanOrEqual(0.9)
    expect(scoreName({ firstName: 'Joaquin', lastName: 'Guzman' }, 'GUZMAN LOERA, Joaquin')).toBeGreaterThanOrEqual(0.9)
  })
  it('does not flag a common name contained in a longer SDN name', () => {
    expect(scoreName({ firstName: 'Jose', lastName: 'Garcia' }, 'GIL GARCIA, Jose Alejandro')).toBeLessThan(0.9)
    expect(
      scoreName({ firstName: 'Maria', lastName: 'Rodriguez' }, 'ESPINOZA RODRIGUEZ, Maria de Jesus'),
    ).toBeLessThan(0.9)
  })
  it('uses the customer middle name to cover the SDN name', () => {
    expect(
      scoreName(
        { firstName: 'Maria', middleName: 'de Jesus', lastName: 'Espinoza Rodriguez' },
        'ESPINOZA RODRIGUEZ, Maria de Jesus',
      ),
    ).toBe(1)
  })
})

describe('DOB handling', () => {
  it('extracts years from remarks', () => {
    expect(dobYears('DOB 10 Dec 1948; POB Egypt')).toEqual([1948])
    expect(dobYears('DOB 1960 to 1962; alt. DOB 1970')).toEqual([1960, 1961, 1962, 1970])
    expect(dobYears('Passport 123')).toEqual([])
  })
  it('flags a conflict only when every listed year is >1 year off', () => {
    expect(dobConflicts('1990-05-01', [1948])).toBe(true)
    expect(dobConflicts('1949-05-01', [1948])).toBe(false)
    expect(dobConflicts(null, [1948])).toBe(false)
    expect(dobConflicts('1990-05-01', [])).toBe(false)
  })
})

describe('evaluateCandidates', () => {
  const cand = {
    ent_num: 2676,
    name: 'AL ZAWAHIRI, Dr. Ayman',
    is_alias: false,
    programs: 'SDGT',
    remarks: 'DOB 19 Jun 1951; POB Giza, Egypt',
  }
  it('returns potential_match for a matching name with compatible DOB', () => {
    const r = evaluateCandidates(
      { firstName: 'Ayman', lastName: 'Zawahiri', dob: '1951-06-19' },
      [cand],
    )
    expect(r.result).toBe('potential_match')
    expect(r.matches[0].ent_num).toBe(2676)
  })
  it('keeps but does not block on a DOB conflict', () => {
    const r = evaluateCandidates(
      { firstName: 'Ayman', lastName: 'Zawahiri', dob: '1995-01-01' },
      [cand],
    )
    expect(r.result).toBe('clear')
    expect(r.matches).toHaveLength(1)
    expect(r.matches[0].dob_conflict).toBe(true)
  })
  it('is clear for unrelated names', () => {
    expect(
      evaluateCandidates({ firstName: 'Maria', lastName: 'Gonzalez' }, [cand]).result,
    ).toBe('clear')
  })
})

describe('parseSdnFeed', () => {
  it('keeps individuals and their aliases only', () => {
    const sdn = parseCsvGrid(
      [
        '36,"AEROCARIBBEAN AIRLINES",-0- ,"CUBA",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ',
        '2674,"ABBAS, Abu","individual","SDGT","Director",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,"DOB 10 Dec 1948; Director."',
      ].join('\n'),
    )
    const alt = parseCsvGrid(
      ['36,12,"aka","AERO-CARIBBEAN",-0- ', '2674,1,"aka","ABBAS, Mohammed",-0- '].join('\n'),
    )
    const rows = parseSdnFeed(sdn, alt)
    expect(rows.map((r) => [r.ent_num, r.name, r.is_alias])).toEqual([
      [2674, 'ABBAS, Abu', false],
      [2674, 'ABBAS, Mohammed', true],
    ])
    expect(rows[0].programs).toBe('SDGT')
    expect(rows[1].remarks).toContain('DOB 10 Dec 1948')
    expect(rows[0].name_norm).toBe('ABBAS ABU')
  })
})
