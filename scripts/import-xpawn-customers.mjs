#!/usr/bin/env node
/**
 * One-time importer: xPawn `Customers.csv` -> Sol Pawn `customers`.
 *
 * Usage:
 *   node scripts/import-xpawn-customers.mjs [path-to-csv]            # DRY RUN
 *   node scripts/import-xpawn-customers.mjs [path-to-csv] --commit   # writes
 *
 * Dry run (default) validates + maps every row, prints a report and a few
 * mapped samples, and touches nothing. --commit inserts in batches via the
 * service-role client and writes ONE audit_log summary row.
 *
 * Idempotent: each row carries legacy_ref = 'xpawn:<Key No>'. Rows whose
 * legacy_ref already exists for the tenant are skipped, so re-running is safe
 * (requires patches/0047 applied: customers.legacy_ref + unique index).
 *
 * Env (from .env.local): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '..')

// ── Target (Eddy's Jewelers Corp. — only tenant) + importing user (superadmin)
const TENANT_ID = '1abc8070-0797-4740-8dea-70cbb16060fe'
const CREATED_BY = '19e8b4b5-9f94-48cc-aa7b-59c62934e96c' // eddydidier@gmail.com
const IMPORT_SOURCE = 'xpawn'
const BATCH = 500

const ID_TYPES = new Set([
  'drivers_license',
  'state_id',
  'passport',
  'military_id',
  'permanent_resident_card',
  'other',
])

// ── env ----------------------------------------------------------------------
function loadEnv() {
  const envFile = resolve(projectRoot, '.env.local')
  if (!existsSync(envFile)) return
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line)
    if (!m || process.env[m[1]]) continue
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
loadEnv()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('[import] Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(2)
}

// ── args ---------------------------------------------------------------------
const args = process.argv.slice(2)
const commit = args.includes('--commit')
const csvPath = resolve(
  process.cwd(),
  args.find((a) => !a.startsWith('--')) ??
    'C:/Users/rodri/Downloads/Customers.csv',
)
if (!existsSync(csvPath)) {
  console.error(`[import] CSV not found: ${csvPath}`)
  process.exit(1)
}

// ── RFC4180 CSV parser (handles quoted commas + embedded newlines) -----------
function parseCsv(text) {
  const rows = []
  let field = ''
  let row = []
  let inQuotes = false
  const s = text.replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); field = ''; row = [] }
    else if (c === '\r') { /* skip */ }
    else field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  const header = rows.shift().map((h) => h.trim())
  return rows
    .filter((r) => r.length > 1)
    .map((r) => {
      const o = {}
      header.forEach((h, i) => { o[h] = (r[i] ?? '').trim() })
      return o
    })
}

// ── normalizers --------------------------------------------------------------
const JUNK = new Set(['', 'n', 'na', 'n/a', '.', '-', '--', 'none', 'null', 'x'])
function clean(v) {
  if (v == null) return null
  let t = String(v).trim().replace(/^"+|"+$/g, '').trim()
  return t === '' ? null : t
}
function cleanField(v) {
  const t = clean(v)
  if (t == null) return null
  return JUNK.has(t.toLowerCase()) ? null : t
}
function normState(v) {
  const t = clean(v)
  return t ? t.toUpperCase().slice(0, 2) : null
}
function normPhone(v) {
  const t = clean(v)
  if (!t) return null
  let d = t.replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1)
  if (d.length !== 10) return null
  if (/^0+$/.test(d) || /^(\d)\1{9}$/.test(d)) return null // 0000000000 / repeated
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
}
function normEmail(v) {
  const t = clean(v)
  if (!t) return null
  const e = t.toLowerCase()
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null
}
function parseMDY(v) {
  const t = clean(v)
  if (!t) return null
  const m = t.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/)
  if (!m) return null
  let mo = +m[1], d = +m[2], y = +m[3]
  if (y < 100) y += y < 30 ? 2000 : 1900
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900 || y > 2035) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
function parseHeight(v) {
  const t = clean(v)
  if (!t) return null
  const d = t.replace(/\D/g, '')
  if (!d) return null
  if (d.length === 3 || d.length === 4) {
    const feet = +d.slice(0, d.length - 2)
    const inch = +d.slice(-2)
    if (inch <= 11) {
      const total = feet * 12 + inch
      if (total >= 36 && total <= 90) return total
    }
  }
  const n = +d
  return n >= 36 && n <= 90 ? n : null // already total inches
}
function parseWeight(v) {
  const t = clean(v)
  if (!t) return null
  const n = parseInt(t.replace(/\D/g, ''), 10)
  return Number.isFinite(n) && n >= 40 && n <= 800 ? n : null
}
function normSex(v) {
  const t = clean(v)
  if (!t) return null
  const c = t[0].toUpperCase()
  return c === 'M' || c === 'F' || c === 'X' ? c : null
}
function mapIdType(v) {
  const t = clean(v)
  if (!t) return null
  const s = t.toLowerCase()
  if (s.includes('passport') || s === 'pp') return 'passport'
  if (s.includes('resident')) return 'permanent_resident_card'
  if (s.includes('military') || s.includes('federal')) return 'military_id'
  if (s.includes('state id') || s === 'id' || s === 'state') return 'state_id'
  if (s.includes('dl') || s.includes('driver') || s.includes("driver's") || s.includes('license'))
    return 'drivers_license'
  return 'other'
}
function isTrue(v) {
  const t = clean(v)
  return t ? /^(true|t|yes|y|1)$/i.test(t) : false
}

// ── map one xPawn row --------------------------------------------------------
const stats = {
  total: 0, skipTest: 0, skipNoName: 0, skipDup: 0, skipExisting: 0,
  dobNull: 0, mapped: 0,
}
function mapRow(row, seen) {
  stats.total++
  const first = cleanField(row['First Name'])
  const last = cleanField(row['Last Name'])
  if (!first && !last) { stats.skipNoName++; return null }

  const key = clean(row['Key No'])
  const idNo = clean(row['ID No'])
  // Drop the obvious dummy record.
  if ((first === 'Test' && last === 'Test') || idNo === '22222222') {
    stats.skipTest++; return null
  }

  const legacyRef = key ? `xpawn:${key}` : null
  if (legacyRef) {
    if (seen.has(legacyRef)) { stats.skipDup++; return null }
    seen.add(legacyRef)
  }

  const suffix = cleanField(row['Suffix'])
  const lastName = [last, suffix].filter(Boolean).join(' ') || last || '—'

  const dob = parseMDY(row['DOB'])
  if (row['DOB'] && !dob) stats.dobNull++

  const phone = normPhone(row['Residence Phone'])
  const email = normEmail(row['EMailAddress'])

  // Notes: preserve xPawn note + a Warning flag banner (Warning = "note only").
  const noteParts = []
  if (isTrue(row['Warning'])) noteParts.push('⚠ xPawn WARNING flag — review before serving')
  const origNotes = cleanField(row['Notes'])
  if (origNotes) noteParts.push(origNotes)

  const record = {
    tenant_id: TENANT_ID,
    first_name: first ?? '—',
    last_name: lastName,
    middle_name: cleanField(row['Middle Name']),
    date_of_birth: dob,
    phone,
    phone_alt: normPhone(row['Business Phone']),
    email,
    address1: cleanField(row['Street']),
    address2: cleanField(row['Address2']),
    city: cleanField(row['City']),
    state: normState(row['State']),
    zip: cleanField(row['Zip Code']),
    country: 'US',
    id_type: (() => { const t = mapIdType(row['ID Type']); return t && ID_TYPES.has(t) ? t : null })(),
    id_number: idNo,
    id_state: normState(row['IDIssueState']),
    id_country: normState(row['IDIssueCountry']) || 'US',
    id_expiry: parseMDY(row['ID1 Expiry'] || row['ID1Expiry']),
    comm_preference: phone ? 'sms' : email ? 'email' : 'none',
    language: 'en',
    marketing_opt_in: isTrue(row['EMailAds']),
    height_inches: parseHeight(row['Height']),
    weight_lbs: parseWeight(row['Weight']),
    sex: normSex(row['Sex']),
    hair_color: cleanField(row['Hair']),
    eye_color: cleanField(row['Eyes']),
    race: cleanField(row['Race']),
    identifying_marks: cleanField(row['Marks']),
    place_of_employment: cleanField(row['Employer Name']),
    notes: noteParts.length ? noteParts.join('\n') : null,
    is_banned: false,
    import_source: IMPORT_SOURCE,
    legacy_ref: legacyRef,
    created_by: CREATED_BY,
    updated_by: CREATED_BY,
  }
  stats.mapped++
  return record
}

// ── run ----------------------------------------------------------------------
async function main() {
  console.log(`[import] source: ${csvPath}`)
  console.log(`[import] mode:   ${commit ? 'COMMIT (writing)' : 'DRY RUN (no writes)'}`)
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  })

  const rows = parseCsv(readFileSync(csvPath, 'utf8'))
  console.log(`[import] parsed ${rows.length} data rows`)

  // Existing legacy_refs for this tenant (idempotency).
  const existing = new Set()
  {
    let from = 0
    for (;;) {
      const { data, error } = await supabase
        .from('customers')
        .select('legacy_ref')
        .eq('tenant_id', TENANT_ID)
        .eq('import_source', IMPORT_SOURCE)
        .not('legacy_ref', 'is', null)
        .range(from, from + 999)
      if (error) { console.error('[import] existing lookup failed:', error.message); process.exit(1) }
      for (const r of data) if (r.legacy_ref) existing.add(r.legacy_ref)
      if (data.length < 1000) break
      from += 1000
    }
  }
  console.log(`[import] already imported (skip): ${existing.size}`)

  const seen = new Set()
  const records = []
  for (const row of rows) {
    const rec = mapRow(row, seen)
    if (!rec) continue
    if (rec.legacy_ref && existing.has(rec.legacy_ref)) { stats.skipExisting++; continue }
    records.push(rec)
  }

  console.log('\n──────── REPORT ────────')
  console.log(`  parsed rows      : ${stats.total}`)
  console.log(`  skipped (no name): ${stats.skipNoName}`)
  console.log(`  skipped (test)   : ${stats.skipTest}`)
  console.log(`  skipped (dup key): ${stats.skipDup}`)
  console.log(`  skipped (already): ${stats.skipExisting}`)
  console.log(`  DOB unparseable  : ${stats.dobNull}`)
  console.log(`  TO INSERT        : ${records.length}`)
  console.log('────────────────────────\n')

  console.log('Sample mapped records (first 5):')
  for (const r of records.slice(0, 5)) {
    console.log('  ' + JSON.stringify({
      name: `${r.last_name}, ${r.first_name}`, dob: r.date_of_birth,
      phone: r.phone, id_type: r.id_type, city: r.city, state: r.state,
      ht: r.height_inches, wt: r.weight_lbs, sex: r.sex, race: r.race,
      legacy_ref: r.legacy_ref,
    }))
  }

  if (!commit) {
    console.log('\n[import] DRY RUN complete — no rows written. Re-run with --commit to insert.')
    return
  }

  console.log(`\n[import] inserting ${records.length} rows in batches of ${BATCH}…`)
  let inserted = 0
  for (let i = 0; i < records.length; i += BATCH) {
    const chunk = records.slice(i, i + BATCH)
    const { error } = await supabase.from('customers').insert(chunk)
    if (error) {
      console.error(`[import] batch ${i / BATCH} failed:`, error.message)
      console.error('[import] aborting; already-inserted rows remain (re-run is idempotent).')
      process.exit(1)
    }
    inserted += chunk.length
    console.log(`  …${inserted}/${records.length}`)
  }

  await supabase.from('audit_log').insert({
    tenant_id: TENANT_ID,
    user_id: CREATED_BY,
    action: 'import',
    table_name: 'customers',
    record_id: null,
    changes: { source: IMPORT_SOURCE, file: 'Customers.csv', inserted, ...stats },
  })

  console.log(`\n[import] DONE — inserted ${inserted} customers into tenant ${TENANT_ID}.`)
}

main().catch((e) => { console.error('[import] fatal:', e); process.exit(1) })
