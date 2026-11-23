#!/usr/bin/env node
/**
 * One-time importer: xPawn tickets, items and payments -> Pawn loans.
 *
 *   node scripts/import-xpawn-loans.mjs stage   --tenant <uuid> --dir <folder> [--skip-customer <key>]...
 *   node scripts/import-xpawn-loans.mjs dry-run --tenant <uuid>
 *   node scripts/import-xpawn-loans.mjs commit  --tenant <uuid> --user <uuid>
 *   node scripts/import-xpawn-loans.mjs drop-stage
 *
 * Three steps, on purpose:
 *   stage    Maps the exports (src/lib/imports/xpawn-loans.ts — pure, tested)
 *            and loads the result into the holding schema `xpawn_stage`.
 *            Touches no table of the app.
 *   dry-run  Runs the whole conversion inside ONE transaction and ends it with
 *            an exception, so the database rolls everything back. Prints what
 *            would have been written, and the checks.
 *   commit   The same conversion, for real. All or nothing: any failed check
 *            aborts and nothing is written.
 *
 * Safe to run again: every row carries a legacy_ref (patches/0099) and rows
 * already imported are skipped.
 *
 * What is NOT written, and why
 *   - compliance_log: these transactions were reported to law enforcement by
 *     the old system when they happened. Writing them would queue 22 years of
 *     pawns for the next police export.
 *   - inventory for old forfeits: those pieces left the shop long ago.
 *   - Buys (ticket type 0): a buy is not a loan.
 *
 * Input: <folder>/Tickets.json, Items.json, PawnPayments.json — each the sheet
 * as an array of rows, header row first (SheetJS `sheet_to_json` with
 * `header: 1, raw: true, cellDates: true`, serialized with JSON.stringify).
 *
 * Money and limits: nothing is recomputed. Rate caps, the minimum charge, the
 * loan term and the timezone are read from the tenant's jurisdiction and
 * settings (CLAUDE.md rule 18); the database triggers still enforce the caps.
 *
 * Env (.env.local): SUPABASE_PROJECT_ID, SUPABASE_ACCESS_TOKEN.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeItemMapper, mapLoan } from '../src/lib/imports/xpawn-loans.ts'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// ── env + API ───────────────────────────────────────────────────────────────
;(function loadEnv() {
  const envFile = resolve(projectRoot, '.env.local')
  if (!existsSync(envFile)) return
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line)
    if (!m || process.env[m[1]]) continue
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
})()
const PROJECT = process.env.SUPABASE_PROJECT_ID
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
if (!PROJECT || !TOKEN) {
  console.error('[xpawn] Missing SUPABASE_PROJECT_ID / SUPABASE_ACCESS_TOKEN in .env.local')
  process.exit(2)
}

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const body = await res.text()
  if (!res.ok) {
    const err = new Error(body)
    err.status = res.status
    throw err
  }
  return JSON.parse(body)
}

// ── args ────────────────────────────────────────────────────────────────────
const [mode, ...rest] = process.argv.slice(2)
const arg = (name) => {
  const i = rest.indexOf(`--${name}`)
  return i >= 0 ? rest[i + 1] : null
}
const argAll = (name) => rest.flatMap((a, i) => (a === `--${name}` ? [rest[i + 1]] : []))
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const tenantId = arg('tenant')
if (mode !== 'drop-stage' && (!tenantId || !UUID.test(tenantId))) {
  console.error('[xpawn] --tenant <uuid> is required')
  process.exit(2)
}

const STAGE = 'xpawn_stage'
const r2 = (n) => Math.round(n * 100) / 100

// ── stage ───────────────────────────────────────────────────────────────────
const STAGE_DDL = `
CREATE SCHEMA IF NOT EXISTS ${STAGE};
REVOKE ALL ON SCHEMA ${STAGE} FROM PUBLIC, anon, authenticated;
DROP TABLE IF EXISTS ${STAGE}.loans, ${STAGE}.items, ${STAGE}.events, ${STAGE}.meta;
CREATE TABLE ${STAGE}.loans (
  legacy_key INT PRIMARY KEY, customer_key INT NOT NULL, pickup_customer_key INT,
  ticket_number TEXT NOT NULL UNIQUE, principal NUMERIC(18,4) NOT NULL, rate NUMERIC(6,4) NOT NULL,
  min_charge NUMERIC(18,4), issue_date DATE NOT NULL, due_date DATE NOT NULL, status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, notes TEXT
);
CREATE TABLE ${STAGE}.items (
  legacy_key INT PRIMARY KEY, ticket_key INT NOT NULL, position INT NOT NULL, description TEXT NOT NULL,
  category TEXT NOT NULL, metal_type TEXT, karat NUMERIC(4,1), weight_grams NUMERIC(10,4),
  est_value NUMERIC(18,4) NOT NULL, jewelry_size TEXT, color TEXT, gemstone_description TEXT,
  unique_marks TEXT, pawn_category_slug TEXT, pawn_subcategory_slug TEXT, firearm_type TEXT,
  firearm_make TEXT, firearm_model TEXT, firearm_caliber TEXT, firearm_serial_number TEXT,
  firearm_action_type TEXT, firearm_finish TEXT, electronic_brand TEXT, electronic_model TEXT,
  electronic_serial TEXT, tool_brand TEXT, tool_model TEXT, created_at TIMESTAMPTZ
);
CREATE TABLE ${STAGE}.events (
  legacy_ref TEXT PRIMARY KEY, ticket_key INT NOT NULL, event_type TEXT NOT NULL, amount NUMERIC(18,4),
  principal_paid NUMERIC(18,4) NOT NULL, interest_paid NUMERIC(18,4) NOT NULL, fees_paid NUMERIC(18,4) NOT NULL,
  payment_method TEXT, new_due_date DATE, notes TEXT, occurred_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX ON ${STAGE}.items (ticket_key);
CREATE INDEX ON ${STAGE}.events (ticket_key);
CREATE TABLE ${STAGE}.meta (key TEXT PRIMARY KEY, value JSONB NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now());
`

function readSheet(dir, name) {
  const file = join(dir, name)
  if (!existsSync(file)) {
    console.error(`[xpawn] not found: ${file}`)
    process.exit(1)
  }
  const rows = JSON.parse(readFileSync(file, 'utf8'))
  return { header: rows[0], rows: rows.slice(1) }
}
const asObjects = ({ header, rows }) => rows.map((r) => Object.fromEntries(header.map((k, i) => [k, r[i]])))

async function loadTable(table, rows, size) {
  for (let i = 0; i < rows.length; i += size) {
    const chunk = JSON.stringify(rows.slice(i, i + size))
    if (chunk.includes('$xpj$')) throw new Error('unexpected quote tag in data')
    await sql(
      `INSERT INTO ${STAGE}.${table} SELECT * FROM jsonb_populate_recordset(NULL::${STAGE}.${table}, $xpj$${chunk}$xpj$::jsonb)`,
    )
    process.stdout.write(`\r[xpawn] ${table}: ${Math.min(i + size, rows.length)} / ${rows.length}`)
  }
  process.stdout.write('\n')
}

async function stage() {
  const dir = arg('dir')
  if (!dir) {
    console.error('[xpawn] --dir <folder> is required')
    process.exit(2)
  }
  const [rules] = await sql(`
    SELECT t.timezone, j.rate_cap_monthly, j.min_charge_cap
      FROM tenants t LEFT JOIN jurisdictions j ON j.code = t.jurisdiction_code
     WHERE t.id = '${tenantId}'`)
  if (!rules?.timezone) {
    console.error('[xpawn] tenant not found, or it has no timezone')
    process.exit(1)
  }
  const opts = {
    timezone: rules.timezone,
    rateCap: rules.rate_cap_monthly == null ? null : Number(rules.rate_cap_monthly),
    minChargeCap: rules.min_charge_cap == null ? null : Number(rules.min_charge_cap),
    skipCustomerKeys: new Set(argAll('skip-customer').map(Number)),
  }
  console.log('[xpawn] rules from the tenant:', JSON.stringify({ ...opts, skipCustomerKeys: [...opts.skipCustomerKeys] }))

  const tickets = asObjects(readSheet(dir, 'Tickets.json'))
  const payments = asObjects(readSheet(dir, 'PawnPayments.json'))
  const itemSheet = readSheet(dir, 'Items.json')

  const paymentsByTicket = new Map()
  for (const p of payments) {
    const k = Number(p['TicketKey'])
    if (!paymentsByTicket.has(k)) paymentsByTicket.set(k, [])
    paymentsByTicket.get(k).push(p)
  }

  const loans = []
  const events = []
  const skipped = {}
  const skippedOpen = []
  let rateApproximated = 0
  const numbers = new Map()
  for (const t of tickets) {
    const res = mapLoan(t, paymentsByTicket.get(Number(t['Ticket Key'])) ?? [], opts)
    if (!res.ok) {
      skipped[res.reason] = (skipped[res.reason] ?? 0) + 1
      if (res.reason !== 'buy' && t['Active'] === true) skippedOpen.push({ ticket: t['Ticket No'], reason: res.reason })
      continue
    }
    if (res.warnings.includes('rate_approximated')) rateApproximated++
    // A number printed twice by the old system: the later ticket keeps it
    // with its key, so both stay findable.
    const n = res.loan.ticket_number
    if (numbers.has(n)) res.loan.ticket_number = `${n}-${res.loan.legacy_key}`
    numbers.set(n, true)
    loans.push(res.loan)
    events.push(...res.events)
  }

  const kept = new Set(loans.map((l) => l.legacy_key))
  const mapItem = makeItemMapper(itemSheet.header)
  const ticketCol = itemSheet.header.indexOf('Ticket Key')
  const noCol = itemSheet.header.indexOf('Item No.')
  const perTicket = new Map()
  for (const row of itemSheet.rows) {
    const k = Number(row[ticketCol])
    if (!kept.has(k)) continue
    if (!perTicket.has(k)) perTicket.set(k, [])
    perTicket.get(k).push(row)
  }
  const items = []
  for (const rows of perTicket.values()) {
    rows.sort((a, b) => Number(a[noCol]) - Number(b[noCol]))
    rows.forEach((row, i) => items.push(mapItem(row, i)))
  }

  // The shop's running ticket number: the highest number written in the last
  // year. (Old out-of-sequence numbers exist and must not move the counter.)
  const newest = loans.reduce((m, l) => (l.issue_date > m ? l.issue_date : m), '')
  const yearAgo = `${Number(newest.slice(0, 4)) - 1}${newest.slice(4)}`
  const lastNumber = loans
    .filter((l) => l.issue_date >= yearAgo && /^\d+$/.test(l.ticket_number))
    .map((l) => Number(l.ticket_number))
    .sort((a, b) => a - b)
  // Median-guarded: ignore a number far above the rest of the year's tickets.
  const median = lastNumber[Math.floor(lastNumber.length / 2)] ?? 0
  const counter = lastNumber.filter((n) => n <= median + 5000).pop() ?? 0

  const sum = (rows, f) => r2(rows.reduce((s, x) => s + f(x), 0))
  const byStatus = {}
  for (const l of loans) byStatus[l.status] = (byStatus[l.status] ?? 0) + 1
  const byEvent = {}
  for (const e of events) byEvent[e.event_type] = (byEvent[e.event_type] ?? 0) + 1
  const expected = {
    loans: loans.length,
    items: items.length,
    events: events.length,
    by_status: byStatus,
    by_event: byEvent,
    principal: sum(loans, (l) => l.principal),
    principal_paid: sum(events, (e) => e.principal_paid),
    interest_paid: sum(events, (e) => e.interest_paid),
    fees_paid: sum(events, (e) => e.fees_paid),
    open_loans: loans.filter((l) => ['active', 'extended', 'partial_paid'].includes(l.status)).length,
    open_principal: sum(loans.filter((l) => ['active', 'extended', 'partial_paid'].includes(l.status)), (l) => l.principal),
    counter,
    skipped,
    skipped_open: skippedOpen,
    rate_approximated: rateApproximated,
    source: { tickets: tickets.length, payments: payments.length, items: itemSheet.rows.length },
  }
  console.log('[xpawn] mapped:', JSON.stringify(expected, null, 1))

  await sql(STAGE_DDL)
  await loadTable('loans', loans, 4000)
  await loadTable('items', items, 4000)
  await loadTable('events', events, 6000)
  await sql(`INSERT INTO ${STAGE}.meta (key, value) VALUES ('tenant', to_jsonb('${tenantId}'::text)), ('expected', $xpj$${JSON.stringify(expected)}$xpj$::jsonb)`)
  const [n] = await sql(`SELECT (SELECT count(*) FROM ${STAGE}.loans) loans, (SELECT count(*) FROM ${STAGE}.items) items, (SELECT count(*) FROM ${STAGE}.events) events`)
  console.log('[xpawn] staged:', JSON.stringify(n))
}

// ── the conversion (one transaction) ────────────────────────────────────────
function conversionSql({ dry, userId }) {
  return `
DO $xpawn$
DECLARE
  v_tenant   UUID := '${tenantId}';
  v_user     UUID := ${userId ? `'${userId}'` : 'NULL'};
  v_dry      BOOLEAN := ${dry ? 'TRUE' : 'FALSE'};
  v_term     INT;
  v_expected JSONB;
  v_loans    INT; v_items INT; v_events INT; v_n INT;
  r          JSONB;
BEGIN
  IF (SELECT value #>> '{}' FROM ${STAGE}.meta WHERE key = 'tenant') IS DISTINCT FROM v_tenant::text THEN
    RAISE EXCEPTION 'xpawn_stage_is_for_another_tenant';
  END IF;
  SELECT value INTO v_expected FROM ${STAGE}.meta WHERE key = 'expected';

  -- Loan term: the jurisdiction's (rule 18). 30 only when it sets none —
  -- the old system's period.
  SELECT COALESCE(j.max_term_days, j.min_term_days, 30) INTO v_term
    FROM tenants t LEFT JOIN jurisdictions j ON j.code = t.jurisdiction_code
   WHERE t.id = v_tenant;

  -- Old customer key -> customer. A customer merged away points to the one kept.
  CREATE TEMP TABLE _xp_cust ON COMMIT DROP AS
  SELECT substr(c.legacy_ref, 7)::int AS k, w.id, w.deleted_at IS NOT NULL AS gone,
         NULLIF(trim(concat_ws(' ', w.first_name, w.last_name)), '') AS name
    FROM customers c
    LEFT JOIN customer_merges m ON m.loser_id = c.id AND m.tenant_id = c.tenant_id
    JOIN customers w ON w.id = COALESCE(m.winner_id, c.id)
   WHERE c.tenant_id = v_tenant AND c.legacy_ref ~ '^xpawn:[0-9]+$';
  CREATE UNIQUE INDEX ON _xp_cust (k);

  SELECT count(*) INTO v_n FROM ${STAGE}.loans s LEFT JOIN _xp_cust c ON c.k = s.customer_key
   WHERE c.id IS NULL OR c.gone;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'xpawn_customers_missing:% (import the customers first)', v_n;
  END IF;

  INSERT INTO loans (tenant_id, customer_id, ticket_number, principal, interest_rate_monthly,
                     min_monthly_charge, term_days, issue_date, due_date, status, is_printed,
                     printed_at, notes, created_at, updated_at, legacy_ref)
  SELECT v_tenant, c.id, s.ticket_number, s.principal, s.rate, s.min_charge, v_term,
         s.issue_date, s.due_date, s.status::loan_status, TRUE, s.created_at, s.notes,
         s.created_at, s.updated_at, 'xpawn:ticket:' || s.legacy_key
    FROM ${STAGE}.loans s JOIN _xp_cust c ON c.k = s.customer_key
   WHERE NOT EXISTS (SELECT 1 FROM loans l WHERE l.tenant_id = v_tenant
                        AND l.legacy_ref = 'xpawn:ticket:' || s.legacy_key)
   ORDER BY s.legacy_key;
  GET DIAGNOSTICS v_loans = ROW_COUNT;

  CREATE TEMP TABLE _xp_loan ON COMMIT DROP AS
  SELECT substr(legacy_ref, 14)::int AS k, id FROM loans
   WHERE tenant_id = v_tenant AND legacy_ref ~ '^xpawn:ticket:[0-9]+$';
  CREATE UNIQUE INDEX ON _xp_loan (k);

  INSERT INTO loan_collateral_items (loan_id, tenant_id, description, category, metal_type, karat,
         weight_grams, est_value, position, created_at, pawn_category_slug, pawn_subcategory_slug,
         firearm_make, firearm_model, firearm_caliber, firearm_serial_number, firearm_type,
         firearm_action_type, firearm_finish, electronic_brand, electronic_model, electronic_serial,
         tool_brand, tool_model, jewelry_size, color, gemstone_description, unique_marks, legacy_ref)
  SELECT l.id, v_tenant, i.description, i.category::inventory_category, i.metal_type::metal_type, i.karat,
         i.weight_grams, i.est_value, i.position, COALESCE(i.created_at, s.created_at),
         i.pawn_category_slug, i.pawn_subcategory_slug,
         i.firearm_make, i.firearm_model, i.firearm_caliber, i.firearm_serial_number, i.firearm_type,
         i.firearm_action_type, i.firearm_finish, i.electronic_brand, i.electronic_model, i.electronic_serial,
         i.tool_brand, i.tool_model, i.jewelry_size, i.color, i.gemstone_description, i.unique_marks,
         'xpawn:item:' || i.legacy_key
    FROM ${STAGE}.items i
    JOIN _xp_loan l ON l.k = i.ticket_key
    JOIN ${STAGE}.loans s ON s.legacy_key = i.ticket_key
   WHERE NOT EXISTS (SELECT 1 FROM loan_collateral_items x WHERE x.tenant_id = v_tenant
                        AND x.legacy_ref = 'xpawn:item:' || i.legacy_key)
   ORDER BY i.ticket_key, i.position;
  GET DIAGNOSTICS v_items = ROW_COUNT;

  -- Who picked the pledge up, when it was not the customer on the ticket.
  INSERT INTO loan_events (loan_id, tenant_id, event_type, amount, principal_paid, interest_paid,
         fees_paid, payment_method, new_due_date, notes, performed_by, occurred_at, legacy_ref)
  SELECT l.id, v_tenant, e.event_type::loan_event_type, e.amount, e.principal_paid, e.interest_paid,
         e.fees_paid, e.payment_method::payment_method, e.new_due_date,
         CASE WHEN e.event_type = 'redemption' AND s.pickup_customer_key IS NOT NULL
                   AND s.pickup_customer_key <> s.customer_key
              THEN concat_ws(' · ',
                     'Picked up by ' || COALESCE(p.name,
                       'another person (old customer #' || s.pickup_customer_key || ', not on file)'),
                     e.notes)
              ELSE e.notes END,
         NULL, e.occurred_at, e.legacy_ref
    FROM ${STAGE}.events e
    JOIN _xp_loan l ON l.k = e.ticket_key
    JOIN ${STAGE}.loans s ON s.legacy_key = e.ticket_key
    LEFT JOIN _xp_cust p ON p.k = s.pickup_customer_key
   WHERE NOT EXISTS (SELECT 1 FROM loan_events x WHERE x.tenant_id = v_tenant AND x.legacy_ref = e.legacy_ref)
   ORDER BY e.ticket_key, e.occurred_at;
  GET DIAGNOSTICS v_events = ROW_COUNT;

  -- New tickets continue the shop's numbering.
  INSERT INTO tenant_counters (tenant_id, counter_name, last_value)
  VALUES (v_tenant, 'loan_ticket', (v_expected ->> 'counter')::bigint)
  ON CONFLICT (tenant_id, counter_name) DO UPDATE
    SET last_value = GREATEST(tenant_counters.last_value, EXCLUDED.last_value), updated_at = now();

  -- What is in the database now, for the imported loans only.
  SELECT jsonb_build_object(
    'inserted', jsonb_build_object('loans', v_loans, 'items', v_items, 'events', v_events),
    'loans', (SELECT count(*) FROM loans WHERE tenant_id = v_tenant AND legacy_ref LIKE 'xpawn:ticket:%'),
    'items', (SELECT count(*) FROM loan_collateral_items WHERE tenant_id = v_tenant AND legacy_ref LIKE 'xpawn:item:%'),
    'events', (SELECT count(*) FROM loan_events WHERE tenant_id = v_tenant AND legacy_ref LIKE 'xpawn:%'),
    'by_status', (SELECT jsonb_object_agg(status, n) FROM (SELECT status, count(*) n FROM loans
                   WHERE tenant_id = v_tenant AND legacy_ref LIKE 'xpawn:ticket:%' GROUP BY 1) x),
    'by_event', (SELECT jsonb_object_agg(event_type, n) FROM (SELECT event_type, count(*) n FROM loan_events
                   WHERE tenant_id = v_tenant AND legacy_ref LIKE 'xpawn:%' GROUP BY 1) x),
    'principal', (SELECT round(sum(principal), 2) FROM loans WHERE tenant_id = v_tenant AND legacy_ref LIKE 'xpawn:ticket:%'),
    'principal_paid', (SELECT round(sum(principal_paid), 2) FROM loan_events WHERE tenant_id = v_tenant AND legacy_ref LIKE 'xpawn:%'),
    'interest_paid', (SELECT round(sum(interest_paid), 2) FROM loan_events WHERE tenant_id = v_tenant AND legacy_ref LIKE 'xpawn:%'),
    'fees_paid', (SELECT round(sum(fees_paid), 2) FROM loan_events WHERE tenant_id = v_tenant AND legacy_ref LIKE 'xpawn:%'),
    'open_loans', (SELECT count(*) FROM loans WHERE tenant_id = v_tenant AND legacy_ref LIKE 'xpawn:ticket:%'
                     AND status IN ('active', 'extended', 'partial_paid')),
    'open_principal', (SELECT round(sum(principal), 2) FROM loans WHERE tenant_id = v_tenant AND legacy_ref LIKE 'xpawn:ticket:%'
                     AND status IN ('active', 'extended', 'partial_paid')),
    'loans_without_items', (SELECT count(*) FROM loans l WHERE l.tenant_id = v_tenant AND l.legacy_ref LIKE 'xpawn:ticket:%'
                     AND NOT EXISTS (SELECT 1 FROM loan_collateral_items i WHERE i.loan_id = l.id)),
    'open_loans_without_items', (SELECT count(*) FROM loans l WHERE l.tenant_id = v_tenant AND l.legacy_ref LIKE 'xpawn:ticket:%'
                     AND l.status IN ('active', 'extended', 'partial_paid')
                     AND NOT EXISTS (SELECT 1 FROM loan_collateral_items i WHERE i.loan_id = l.id)),
    'pickups_by_another_person', (SELECT count(*) FROM loan_events WHERE tenant_id = v_tenant AND legacy_ref LIKE 'xpawn:%'
                     AND event_type = 'redemption' AND notes LIKE 'Picked up by %'),
    'customers_with_loans', (SELECT count(DISTINCT customer_id) FROM loans WHERE tenant_id = v_tenant AND legacy_ref LIKE 'xpawn:ticket:%'),
    'first_issue', (SELECT min(issue_date) FROM loans WHERE tenant_id = v_tenant AND legacy_ref LIKE 'xpawn:ticket:%'),
    'last_issue', (SELECT max(issue_date) FROM loans WHERE tenant_id = v_tenant AND legacy_ref LIKE 'xpawn:ticket:%'),
    'next_ticket_counter', (SELECT last_value FROM tenant_counters WHERE tenant_id = v_tenant AND counter_name = 'loan_ticket'),
    'compliance_rows_written', 0,
    'term_days', v_term
  ) INTO r;

  -- The database must hold exactly what was mapped. Anything else: stop.
  IF (r ->> 'loans')::int <> (v_expected ->> 'loans')::int
     OR (r ->> 'items')::int <> (v_expected ->> 'items')::int
     OR (r ->> 'events')::int <> (v_expected ->> 'events')::int
     OR abs((r ->> 'principal')::numeric - (v_expected ->> 'principal')::numeric) > 0.01
     OR abs((r ->> 'principal_paid')::numeric - (v_expected ->> 'principal_paid')::numeric) > 0.01
     OR abs((r ->> 'interest_paid')::numeric - (v_expected ->> 'interest_paid')::numeric) > 0.01
     OR abs(COALESCE((r ->> 'fees_paid')::numeric, 0) - (v_expected ->> 'fees_paid')::numeric) > 0.01
     OR (r ->> 'open_loans')::int <> (v_expected ->> 'open_loans')::int THEN
    RAISE EXCEPTION 'xpawn_totals_mismatch % expected %', r::text, v_expected::text;
  END IF;

  IF v_dry THEN
    RAISE EXCEPTION 'XPAWN_DRYRUN %', r::text;
  END IF;

  INSERT INTO audit_log (tenant_id, user_id, action, table_name, record_id, changes)
  VALUES (v_tenant, v_user, 'import', 'loans', NULL,
          jsonb_build_object('source', 'xpawn', 'files', jsonb_build_array('Tickets.xls', 'Items.xls', 'PawnPayments.xls'),
                             'result', r, 'skipped', v_expected -> 'skipped'));
  INSERT INTO ${STAGE}.meta (key, value) VALUES ('last_run', r)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
END;
$xpawn$;`
}

/** The summary the conversion raised: the API wraps it as {"message": "... XPAWN_DRYRUN {json} ..."}. */
function dryRunResult(body) {
  let message = body
  try {
    message = JSON.parse(body).message ?? body
  } catch {
    // not JSON — use the text as it is
  }
  const start = message.indexOf('XPAWN_DRYRUN {')
  if (start < 0) return null
  const from = message.indexOf('{', start)
  let depth = 0
  let inString = false
  for (let i = from; i < message.length; i++) {
    const ch = message[i]
    if (inString) {
      if (ch === '\\') i++
      else if (ch === '"') inString = false
    } else if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) return JSON.parse(message.slice(from, i + 1))
  }
  return null
}

async function dryRun() {
  try {
    await sql(conversionSql({ dry: true, userId: null }))
    console.error('[xpawn] the dry run did not roll back — STOP and check the database')
    process.exit(1)
  } catch (e) {
    const result = dryRunResult(String(e.message))
    if (!result) {
      console.error('[xpawn] dry run FAILED (nothing was written):\n' + String(e.message).slice(0, 6000))
      process.exit(1)
    }
    console.log('[xpawn] DRY RUN — rolled back, nothing written. It would have been:')
    console.log(JSON.stringify(result, null, 1))
  }
}

async function commit() {
  const userId = arg('user')
  if (!userId || !UUID.test(userId)) {
    console.error('[xpawn] --user <uuid> (who runs the import, for the audit log) is required')
    process.exit(2)
  }
  await sql(conversionSql({ dry: false, userId }))
  const [row] = await sql(`SELECT value FROM ${STAGE}.meta WHERE key = 'last_run'`)
  console.log('[xpawn] IMPORTED:')
  console.log(JSON.stringify(row.value, null, 1))
}

try {
  if (mode === 'stage') await stage()
  else if (mode === 'dry-run') await dryRun()
  else if (mode === 'commit') await commit()
  else if (mode === 'drop-stage') {
    await sql(`DROP SCHEMA IF EXISTS ${STAGE} CASCADE`)
    console.log('[xpawn] holding schema dropped')
  } else {
    console.error('usage: import-xpawn-loans.mjs stage|dry-run|commit|drop-stage --tenant <uuid> ...')
    process.exit(2)
  }
} catch (e) {
  console.error('[xpawn] FAILED:', String(e.message).slice(0, 6000))
  process.exit(1)
}
