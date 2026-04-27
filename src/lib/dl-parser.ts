/**
 * AAMVA PDF417 driver-license parser. Zero dependencies.
 *
 * Source: ported from C:\Users\rodri\OneDrive\Documents\Claude\code\dl-scanner\
 * which extracted it from Luna Azul Web SaaS. Single source of truth lives
 * in this file — do not edit upstream copies.
 *
 * The parser handles two scanner output styles (newline-delimited and
 * stripped) and falls back to the second style when fields are missing
 * from the first pass.
 */

export interface DLInfo {
  lastName: string
  firstName: string
  middleName: string
  suffix: string
  dob: string
  expirationDate: string
  issuedDate: string
  gender: string
  address: string
  city: string
  state: string
  zip: string
  height: string
  licenseNumber: string
  auditInfo: string
  realIdCompliant: boolean
}

function parseDate(s: string): string {
  const digits = s.replace(/\D/g, '').slice(0, 8)
  if (digits.length !== 8) return ''
  const mm = digits.slice(0, 2)
  const dd = digits.slice(2, 4)
  const yyyy = digits.slice(4, 8)
  return `${yyyy}-${mm}-${dd}`
}

function emptyInfo(): DLInfo {
  return {
    lastName: '', firstName: '', middleName: '', suffix: '',
    dob: '', expirationDate: '', issuedDate: '', gender: '',
    address: '', city: '', state: '', zip: '', height: '',
    licenseNumber: '', auditInfo: '', realIdCompliant: false,
  }
}

const FIELD_CODES = [
  'DCS', 'DAC', 'DAD', 'DAE', 'DCT', 'DCU',
  'DBB', 'DBA', 'DBD', 'DBC',
  'DAG', 'DAI', 'DAJ', 'DAK',
  'DAU', 'DAQ', 'DCK', 'DDA',
  'DAY', 'DAZ', 'DCG', 'DDB', 'DDE', 'DDF', 'DDG',
  'DCF', 'DCA', 'DCB', 'DCD', 'DCE', 'DCL', 'DCM',
]

function extractFields(raw: string): Map<string, string> {
  const map = new Map<string, string>()

  const hits: { pos: number; code: string }[] = []
  for (const code of FIELD_CODES) {
    let idx = 0
    while (true) {
      idx = raw.indexOf(code, idx)
      if (idx === -1) break
      hits.push({ pos: idx, code })
      idx += code.length
    }
  }
  hits.sort((a, b) => a.pos - b.pos)

  for (let i = 0; i < hits.length; i++) {
    const { pos, code } = hits[i]
    const valStart = pos + code.length
    const valEnd = i + 1 < hits.length ? hits[i + 1].pos : raw.length
    const value = raw.slice(valStart, valEnd).replace(/[\r\n]+$/, '').trim()
    if (!map.has(code)) map.set(code, value)
  }

  return map
}

export function parseDriverLicense(rawData: string): DLInfo {
  const info = emptyInfo()

  const hasLines = /[\r\n]/.test(rawData)
  if (hasLines) {
    const normalized = rawData.replace(/DL/g, '\r\nDAQ')
    const lines = normalized.split(/[\r\n]+/).filter(l => l.length > 0)
    for (const line of lines) {
      if (line.startsWith('DCS')) info.lastName = line.substring(3).trim()
      else if (line.startsWith('DAC')) info.firstName = line.substring(3).trim()
      else if (line.startsWith('DAD')) info.middleName = line.substring(3).trim()
      else if (line.startsWith('DAE')) info.suffix = line.substring(3).trim()
      else if (line.startsWith('DBB')) info.dob = parseDate(line.substring(3).trim())
      else if (line.startsWith('DBA')) info.expirationDate = parseDate(line.substring(3).trim())
      else if (line.startsWith('DBD')) info.issuedDate = parseDate(line.substring(3).trim())
      else if (line.startsWith('DBC')) info.gender = line.substring(3).trim() === '1' ? 'M' : 'F'
      else if (line.startsWith('DAG')) info.address = line.substring(3).trim()
      else if (line.startsWith('DAI')) info.city = line.substring(3).trim()
      else if (line.startsWith('DAJ')) info.state = line.substring(3).trim()
      else if (line.startsWith('DAK')) info.zip = line.substring(3).trim().slice(0, 5)
      else if (line.startsWith('DAU')) info.height = line.substring(3).trim()
      else if (line.startsWith('DAQ')) info.licenseNumber = line.substring(6).trim() || line.substring(3).trim()
      else if (line.startsWith('DCK')) info.auditInfo = line.substring(3).trim()
      else if (line.startsWith('DDA')) info.realIdCompliant = line.substring(3).trim().toUpperCase() === 'F'
    }
  }

  const fields = extractFields(rawData)
  const take = (code: string, current: string) => current || fields.get(code) || ''

  info.lastName       = take('DCS', info.lastName)
  info.firstName      = take('DAC', info.firstName)
  info.middleName     = take('DAD', info.middleName)
  info.suffix         = take('DAE', info.suffix)
  info.address        = take('DAG', info.address)
  info.city           = take('DAI', info.city)
  info.state          = take('DAJ', info.state)
  info.zip            = info.zip || (fields.get('DAK') || '').slice(0, 5)
  info.height         = take('DAU', info.height)
  info.auditInfo      = take('DCK', info.auditInfo)
  info.dob            = info.dob || parseDate(fields.get('DBB') || '')
  info.expirationDate = info.expirationDate || parseDate(fields.get('DBA') || '')
  info.issuedDate     = info.issuedDate || parseDate(fields.get('DBD') || '')
  if (!info.gender) {
    const g = fields.get('DBC') || ''
    info.gender = g === '1' ? 'M' : g === '2' ? 'F' : ''
  }
  if (!info.licenseNumber) {
    const daq = fields.get('DAQ') || ''
    info.licenseNumber = daq.replace(/^DL/, '').trim()
  }
  if (!info.realIdCompliant) {
    info.realIdCompliant = (fields.get('DDA') || '').toUpperCase() === 'F'
  }

  return info
}

/**
 * Parse the AAMVA height string (e.g. "071 in", "180 cm", "069") into total
 * inches as a number. Returns null if unparseable.
 *
 * AAMVA spec defines height in inches with " in" suffix for US issuers; some
 * Canadian issuers report cm. Convert to inches in either case.
 */
export function parseHeightInches(raw: string): number | null {
  if (!raw) return null
  const lower = raw.toLowerCase().trim()
  const numMatch = lower.match(/(\d+)/)
  if (!numMatch) return null
  const n = parseInt(numMatch[1], 10)
  if (!Number.isFinite(n) || n <= 0) return null
  if (lower.includes('cm')) {
    return Math.round(n / 2.54)
  }
  return n
}
