/**
 * Customer-import engine: field normalizers, header auto-guessing, and the
 * row -> customer-insert mapping that produces both the insert records and a
 * report. Pure logic (no I/O) — the route handler feeds it parsed rows + a
 * mapping and does the actual DB work.
 */

import {
  TARGET_FIELDS,
  type ImportReport,
  type ImportSampleRow,
  type Mapping,
  type TargetField,
} from './catalog'

// ── normalizers ─────────────────────────────────────────────────────────────

const JUNK = new Set(['', 'n', 'na', 'n/a', '.', '-', '--', 'none', 'null', 'x', 'unknown'])

export function cstr(v: string | undefined | null): string | null {
  if (v == null) return null
  const t = String(v).trim().replace(/^"+|"+$/g, '').trim()
  return t === '' ? null : t
}
function cclean(v: string | undefined | null): string | null {
  const t = cstr(v)
  return t && !JUNK.has(t.toLowerCase()) ? t : null
}
function cstate(v: string | undefined | null): string | null {
  const t = cstr(v)
  return t ? t.toUpperCase().slice(0, 2) : null
}
function cphone(v: string | undefined | null): string | null {
  const t = cstr(v)
  if (!t) return null
  let d = t.replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1)
  if (d.length !== 10) return null
  if (/^0+$/.test(d) || /^(\d)\1{9}$/.test(d)) return null
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
}
function cemail(v: string | undefined | null): string | null {
  const t = cstr(v)
  if (!t) return null
  const e = t.toLowerCase()
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}
function isoParts(y: number, mo: number, d: number): string | null {
  if (y < 100) y += y < 30 ? 2000 : 1900
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900 || y > 2035) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
export function cdate(v: string | undefined | null): string | null {
  const t = cstr(v)
  if (!t) return null
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/) // ISO
  if (m) return isoParts(+m[1], +m[2], +m[3])
  m = t.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/) // M/D/Y
  if (m) return isoParts(+m[3], +m[1], +m[2])
  m = t.match(/^(\d{1,2})[-/ ]([A-Za-z]{3})[A-Za-z]*[-/ ](\d{2,4})$/) // D-Mon-YY
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()]
    if (mo) return isoParts(+m[3], mo, +m[1])
  }
  return null
}
function cheight(v: string | undefined | null): number | null {
  const t = cstr(v)
  if (!t) return null
  const fi = t.match(/^(\d)\s*['’ft]\s*(\d{1,2})?/) // 5'10" / 5ft10 / 5' 10
  if (fi) {
    const inch = fi[2] ? +fi[2] : 0
    if (inch <= 11) { const tot = +fi[1] * 12 + inch; if (tot >= 36 && tot <= 90) return tot }
  }
  const d = t.replace(/\D/g, '')
  if (d.length === 3 || d.length === 4) {
    const feet = +d.slice(0, d.length - 2)
    const inch = +d.slice(-2)
    if (inch <= 11) { const tot = feet * 12 + inch; if (tot >= 36 && tot <= 90) return tot }
  }
  const n = +d
  return n >= 36 && n <= 90 ? n : null
}
function cweight(v: string | undefined | null): number | null {
  const t = cstr(v)
  if (!t) return null
  const n = parseInt(t.replace(/\D/g, ''), 10)
  return Number.isFinite(n) && n >= 40 && n <= 800 ? n : null
}
function csex(v: string | undefined | null): string | null {
  const t = cstr(v)
  if (!t) return null
  const c = t[0].toUpperCase()
  return c === 'M' || c === 'F' || c === 'X' ? c : null
}
const ID_TYPES = new Set([
  'drivers_license', 'state_id', 'passport', 'military_id',
  'permanent_resident_card', 'other',
])
function cidtype(v: string | undefined | null): string | null {
  const t = cstr(v)
  if (!t) return null
  const s = t.toLowerCase()
  if (s.includes('passport') || s === 'pp') return 'passport'
  if (s.includes('resident')) return 'permanent_resident_card'
  if (s.includes('military') || s.includes('federal')) return 'military_id'
  if (s.includes('state id') || s === 'id' || s === 'state') return 'state_id'
  if (s.includes('dl') || s.includes('driver') || s.includes('license')) return 'drivers_license'
  return 'other'
}
function ctrue(v: string | undefined | null): boolean {
  const t = cstr(v)
  return t ? /^(true|t|yes|y|1)$/i.test(t) : false
}

// ── auto-guess mapping from headers ─────────────────────────────────────────

function norm(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}
export function autoGuessMapping(headers: string[]): Mapping {
  const normed = headers.map((h) => ({ raw: h, n: norm(h) }))
  const used = new Set<string>()
  const mapping: Mapping = {}
  for (const def of TARGET_FIELDS) {
    // Exact hint match first, then substring.
    const hit =
      normed.find((h) => !used.has(h.raw) && def.hints.some((k) => h.n === k)) ??
      normed.find((h) => !used.has(h.raw) && def.hints.some((k) => h.n.includes(k)))
    if (hit) { mapping[def.field] = hit.raw; used.add(hit.raw) }
  }
  return mapping
}

// ── row -> customer insert ──────────────────────────────────────────────────

export type CustomerInsert = Record<string, unknown>

const FIELD_NORMALIZER: Partial<Record<TargetField, (v: string | null) => unknown>> = {
  date_of_birth: cdate,
  id_expiry: cdate,
  phone: cphone,
  phone_alt: cphone,
  email: cemail,
  state: cstate,
  id_state: cstate,
  id_country: cstate,
  height: cheight,
  weight: cweight,
  sex: csex,
  id_type: cidtype,
}

export type MapOptions = {
  rows: Array<Record<string, string>>
  mapping: Mapping
  importSource: string
  tenantId: string
  createdBy: string
  existingRefs: Set<string>
  /** Header whose truthy value prepends a WARNING banner to notes (xPawn). */
  warningHeader?: string
  /** Skip an obvious dummy row (xPawn ships a Test/Test record). */
  skipTest?: boolean
}

export function mapRows(opts: MapOptions): {
  records: CustomerInsert[]
  report: ImportReport
  samples: ImportSampleRow[]
} {
  const { rows, mapping, importSource, tenantId, createdBy, existingRefs } = opts
  const report: ImportReport = {
    totalRows: rows.length, toInsert: 0, skippedNoName: 0,
    skippedDup: 0, skippedExisting: 0, dobUnparseable: 0, warnings: [],
  }
  const records: CustomerInsert[] = []
  const samples: ImportSampleRow[] = []
  const seen = new Set<string>()

  const raw = (row: Record<string, string>, f: TargetField): string | null => {
    const header = mapping[f]
    return header ? cstr(row[header]) : null
  }

  if (!mapping.first_name && !mapping.last_name) {
    report.warnings.push('No first/last name column mapped — all rows will be skipped.')
  }
  if (!mapping.legacy_ref) {
    report.warnings.push('No source-ID (dedupe key) mapped — re-running this import would create duplicates.')
  }

  for (const row of rows) {
    const first = mapping.first_name ? cclean(row[mapping.first_name]) : null
    const last = mapping.last_name ? cclean(row[mapping.last_name]) : null
    if (!first && !last) { report.skippedNoName++; continue }

    const idNo = raw(row, 'id_number')
    if (opts.skipTest && ((first === 'Test' && last === 'Test') || idNo === '22222222')) {
      continue
    }

    let legacyRef: string | null = null
    if (mapping.legacy_ref) {
      const key = cstr(row[mapping.legacy_ref])
      if (key) {
        legacyRef = `${importSource}:${key}`
        if (seen.has(legacyRef)) { report.skippedDup++; continue }
        seen.add(legacyRef)
        if (existingRefs.has(legacyRef)) { report.skippedExisting++; continue }
      }
    }

    const suffix = raw(row, 'suffix')
    const lastName = [last, suffix].filter(Boolean).join(' ') || last || '—'

    const get = (f: TargetField): unknown => {
      const header = mapping[f]
      if (!header) return null
      const n = FIELD_NORMALIZER[f]
      const val = row[header]
      return n ? n(cstr(val)) : cclean(val)
    }

    const dob = get('date_of_birth') as string | null
    if (mapping.date_of_birth && row[mapping.date_of_birth]?.trim() && !dob) report.dobUnparseable++

    const phone = get('phone') as string | null
    const email = get('email') as string | null

    const noteParts: string[] = []
    if (opts.warningHeader && ctrue(row[opts.warningHeader])) {
      noteParts.push('⚠ Imported WARNING flag — review before serving')
    }
    const origNotes = get('notes') as string | null
    if (origNotes) noteParts.push(origNotes)

    records.push({
      tenant_id: tenantId,
      first_name: first ?? '—',
      last_name: lastName,
      middle_name: get('middle_name'),
      date_of_birth: dob,
      phone,
      phone_alt: get('phone_alt'),
      email,
      address1: get('address1'),
      address2: get('address2'),
      city: get('city'),
      state: get('state'),
      zip: get('zip'),
      country: (get('country') as string | null) || 'US',
      id_type: (() => { const t = get('id_type') as string | null; return t && ID_TYPES.has(t) ? t : null })(),
      id_number: idNo,
      id_state: get('id_state'),
      id_country: (get('id_country') as string | null) || 'US',
      id_expiry: get('id_expiry'),
      comm_preference: phone ? 'sms' : email ? 'email' : 'none',
      language: 'en',
      marketing_opt_in: false,
      height_inches: get('height'),
      weight_lbs: get('weight'),
      sex: get('sex'),
      hair_color: get('hair_color'),
      eye_color: get('eye_color'),
      race: get('race'),
      identifying_marks: get('identifying_marks'),
      place_of_employment: get('place_of_employment'),
      notes: noteParts.length ? noteParts.join('\n') : null,
      is_banned: false,
      import_source: importSource,
      legacy_ref: legacyRef,
      created_by: createdBy,
      updated_by: createdBy,
    })
    report.toInsert++
    if (samples.length < 10) {
      const r = records[records.length - 1]
      samples.push({
        name: `${r.last_name}, ${r.first_name}`,
        dob: r.date_of_birth as string | null,
        phone: r.phone as string | null,
        id_type: r.id_type as string | null,
        city: r.city as string | null,
        state: r.state as string | null,
        legacy_ref: r.legacy_ref as string | null,
      })
    }
  }

  return { records, report, samples }
}
