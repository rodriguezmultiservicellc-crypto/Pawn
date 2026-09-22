#!/usr/bin/env node
/**
 * Real-browser smoke over the staff surface.
 *
 * Drives installed Chrome (or Edge) through playwright-core against a running
 * dev server, as a genuinely authenticated session. Unlike an HTTP-level check
 * this catches what only a browser sees: hydration mismatches, client-component
 * crashes, uncaught exceptions, console errors and failed subresource requests.
 *
 * Usage:
 *   npm run dev                       # or dev:raw, in another terminal
 *   npm run smoke:browser             # all routes
 *   npm run smoke:browser -- --gates  # also flip the feature-4 module gates on
 *                                     # for the run, then restore them
 *   SMOKE_HEADED=1 npm run smoke:browser   # watch it drive
 *
 * Env (.env.local): NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *                   SUPABASE_SERVICE_ROLE_KEY
 *
 * READ-ONLY on business data — it only navigates. With --gates it writes the two
 * settings booleans and restores them in a finally block.
 *
 * Exit 0 when every route is clean; exit 1 on any failure.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient as createJsClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { chromium } from 'playwright-core'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '..')
const BASE = process.env.SMOKE_BASE ?? 'http://localhost:3060'
const WITH_GATES = process.argv.includes('--gates')
const HEADED = process.env.SMOKE_HEADED === '1'
// --only=<substring> narrows the run to matching routes; --verbose keeps the
// whole React hydration diff instead of the first line.
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7)
const ERR_CHARS = process.argv.includes('--verbose') ? 4000 : 220
const REPEAT = Number((process.argv.find((a) => a.startsWith('--repeat=')) ?? '').slice(9)) || 1
const OUT_DIR = process.env.SMOKE_OUT ?? resolve(projectRoot, '.smoke')

// ── env ────────────────────────────────────────────────────────────────────
const envFile = resolve(projectRoot, '.env.local')
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPA_URL || !ANON || !SVC) {
  console.error('smoke-browser: missing Supabase env in .env.local')
  process.exit(1)
}

// ── find a browser ─────────────────────────────────────────────────────────
function findBrowser() {
  const pf = process.env['ProgramFiles'] ?? 'C:\\Program Files'
  const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  const local = process.env['LOCALAPPDATA'] ?? ''
  const candidates = [
    `${pf}\\Google\\Chrome\\Application\\chrome.exe`,
    `${pf86}\\Google\\Chrome\\Application\\chrome.exe`,
    `${local}\\Google\\Chrome\\Application\\chrome.exe`,
    `${pf}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${pf86}\\Microsoft\\Edge\\Application\\msedge.exe`,
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ]
  return candidates.find((p) => existsSync(p)) ?? null
}

// ── session ────────────────────────────────────────────────────────────────
const admin = createJsClient(SUPA_URL, SVC, { auth: { persistSession: false } })

const { data: profs, error: profErr } = await admin
  .from('profiles').select('id, tenant_id, role').eq('role', 'superadmin')
if (profErr) throw new Error('profiles: ' + profErr.message)
if (!profs?.length) throw new Error('no superadmin profile to sign in as')

const { data: userList } = await admin.auth.admin.listUsers({ perPage: 200 })
const target = userList.users.find((u) => u.id === profs[0].id)
if (!target) throw new Error('superadmin profile has no matching auth user')

const { data: memberships } = await admin
  .from('user_tenants').select('tenant_id, role')
  .eq('user_id', target.id).eq('is_active', true)
const tenantId =
  memberships?.find((m) => m.role === 'owner')?.tenant_id ?? profs[0].tenant_id
if (!tenantId) throw new Error('no tenant to act in')

const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
  type: 'magiclink', email: target.email,
})
if (linkErr) throw new Error('generateLink: ' + linkErr.message)

const anonClient = createJsClient(SUPA_URL, ANON, {
  auth: { persistSession: false, autoRefreshToken: false, flowType: 'implicit' },
})
const { data: otp, error: otpErr } = await anonClient.auth.verifyOtp({
  token_hash: link.properties.hashed_token, type: 'magiclink',
})
if (otpErr) throw new Error('verifyOtp: ' + otpErr.message)

// Let @supabase/ssr produce the cookies rather than hand-rolling its format.
const jar = new Map()
const ssr = createServerClient(SUPA_URL, ANON, {
  cookies: {
    getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
    setAll: (list) => list.forEach(({ name, value }) => jar.set(name, value)),
  },
})
await ssr.auth.setSession({
  access_token: otp.session.access_token,
  refresh_token: otp.session.refresh_token,
})
jar.set('pawn-active-tenant', tenantId)

// ── real record ids for the detail routes ──────────────────────────────────
const pickId = async (table) => {
  const { data } = await admin.from(table).select('id').eq('tenant_id', tenantId).limit(1)
  return data?.[0]?.id ?? null
}
const ids = {
  customer: await pickId('customers'),
  sale: await pickId('sales'),
  loan: await pickId('loans'),
  item: await pickId('inventory_items'),
  repair: await pickId('repair_tickets'),
  consignor: await pickId('consignors'),
  layaway: await pickId('layaways'),
}

const ROUTES = [
  ['F1 jurisdiction rules', '/settings/compliance'],
  ['F1 loan rate menu', '/settings/loan-rates'],
  ['F1 pawn calculator', '/pawn/calculator'],
  ['F2 comms automations', '/settings/communications'],
  ['F3 pawn intake (OFAC)', '/pawn/new'],
  ['F3 buy intake (OFAC)', '/buy/new'],
  ['F4 store-credit settings', '/settings/store-credit'],
  ['F4 consignment settings', '/settings/consignment'],
  ['F4 consignors list', '/consignors'],
  ['F4 consignor new', '/consignors/new'],
  ['F4 consignor detail', ids.consignor && `/consignors/${ids.consignor}`],
  ['F4 customer detail', ids.customer && `/customers/${ids.customer}`],
  ['F4 sale detail', ids.sale && `/pos/sales/${ids.sale}`],
  ['POS new sale', '/pos/sales/new'],
  ['POS layaways', '/pos/layaways'],
  ['POS layaway detail', ids.layaway && `/pos/layaways/${ids.layaway}`],
  ['reports hub', '/reports'],
  ['police report', '/reports/police-report'],
  ['daily register', '/reports/daily-register'],
  ['inventory turn', '/reports/inventory-turn'],
  ['pawn aging', '/reports/pawn-aging'],
  ['dashboard', '/dashboard'],
  ['customers', '/customers'],
  ['inventory', '/inventory'],
  ['inventory detail', ids.item && `/inventory/${ids.item}`],
  ['pawn', '/pawn'],
  ['loan detail', ids.loan && `/pawn/${ids.loan}`],
  ['repair', '/repair'],
  ['repair detail', ids.repair && `/repair/${ids.repair}`],
  ['pos', '/pos'],
  ['settings hub', '/settings'],
  ['team', '/team'],
  ['audit', '/audit'],
]
  .filter(([, p]) => p)
  .filter(([label, p]) => !ONLY || p.includes(ONLY) || label.includes(ONLY))
  .flatMap((r) => Array.from({ length: REPEAT }, () => r))

// A leaked dictionary key rendered as text: lowercase head, 3+ dotted segments.
const KEY_RE = /^[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*){2,}$/

const exe = findBrowser()
if (!exe) {
  console.error('smoke-browser: no Chrome/Edge found. Install one, or set SMOKE_EXE.')
  process.exit(1)
}
console.log(`browser : ${exe}`)
console.log(`base    : ${BASE}`)
console.log(`user    : ${target.email}  (superadmin)`)
console.log(`tenant  : ${tenantId}`)
console.log(`ids     : ${JSON.stringify(ids)}`)

let gatesBefore = null
if (WITH_GATES) {
  const { data } = await admin.from('settings')
    .select('store_credit_enabled, consignment_enabled')
    .eq('tenant_id', tenantId).maybeSingle()
  gatesBefore = data
  await admin.from('settings')
    .update({ store_credit_enabled: true, consignment_enabled: true })
    .eq('tenant_id', tenantId)
  console.log(`gates   : forced ON for this run (were ${JSON.stringify(data)})`)
}

mkdirSync(OUT_DIR, { recursive: true })

const results = []
const browser = await chromium.launch({ executablePath: exe, headless: !HEADED })
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addCookies(
    [...jar.entries()].map(([name, value]) => ({
      name, value, domain: 'localhost', path: '/',
    })),
  )

  for (const [label, path] of ROUTES) {
    const consoleErrors = []
    const pageErrors = []
    const badRequests = []
    const page = await context.newPage()

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, ERR_CHARS))
    })
    page.on('pageerror', (err) => pageErrors.push(String(err.message).slice(0, ERR_CHARS)))
    page.on('response', (res) => {
      const u = res.url()
      if (res.status() >= 400 && u.startsWith(BASE)) {
        badRequests.push(`${res.status()} ${u.replace(BASE, '')}`)
      }
    })

    const t0 = Date.now()
    let status = '?'
    let landed = path
    try {
      const res = await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 45000 })
      status = res?.status() ?? '?'
      landed = new URL(page.url()).pathname
      // Give hydration a beat to throw if it is going to.
      await page.waitForTimeout(400)
    } catch (e) {
      status = 'NAV'
      pageErrors.push('navigation: ' + e.message.slice(0, 160))
    }
    const ms = Date.now() - t0

    // Scan rendered text for untranslated dictionary keys.
    let echoes = []
    try {
      echoes = await page.evaluate((src) => {
        const re = new RegExp(src)
        const out = new Set()
        const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
        for (let n = walk.nextNode(); n; n = walk.nextNode()) {
          const t = n.textContent.trim()
          if (t && t.length < 90 && re.test(t)) out.add(t)
        }
        return [...out].slice(0, 5)
      }, KEY_RE.source)
    } catch { /* page already torn down */ }

    let shot = ''
    try {
      shot = resolve(OUT_DIR, `${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`)
      await page.screenshot({ path: shot, fullPage: false })
    } catch { shot = '' }

    await page.close()

    const problems = []
    if (typeof status === 'number' && status >= 400) problems.push(`HTTP ${status}`)
    if (landed !== path) problems.push(`redirected -> ${landed}`)
    if (pageErrors.length) problems.push(`UNCAUGHT: ${pageErrors[0]}`)
    if (consoleErrors.length) problems.push(`console(${consoleErrors.length}): ${consoleErrors[0]}`)
    if (badRequests.length) problems.push(`req: ${[...new Set(badRequests)].slice(0, 2).join(', ')}`)
    if (echoes.length) problems.push(`i18n echo: ${echoes.join(', ')}`)

    results.push({ label, path, status, ms, problems, shot })
    const mark = problems.length ? '!!' : '  '
    console.log(
      `${mark} ${String(status).padEnd(4)} ${String(ms + 'ms').padStart(7)}  ${label.padEnd(26)} ${problems.length ? problems.join(' | ') : 'clean'}`,
    )
  }
} finally {
  await browser.close()
  if (WITH_GATES) {
    await admin.from('settings')
      .update({
        store_credit_enabled: gatesBefore?.store_credit_enabled ?? false,
        consignment_enabled: gatesBefore?.consignment_enabled ?? false,
      })
      .eq('tenant_id', tenantId)
    const { data: after } = await admin.from('settings')
      .select('store_credit_enabled, consignment_enabled')
      .eq('tenant_id', tenantId).maybeSingle()
    console.log(`gates   : restored -> ${JSON.stringify(after)}`)
  }
}

const bad = results.filter((r) => r.problems.length)
console.log(`\n${results.length - bad.length}/${results.length} clean · screenshots in ${OUT_DIR}`)
if (bad.length) {
  console.log('\nfailures:')
  for (const r of bad) {
    console.log(`  ${r.path}\n    ${r.problems.join('\n    ')}`)
    if (r.shot) console.log(`    shot: ${r.shot}`)
  }
}
process.exit(bad.length ? 1 : 0)
