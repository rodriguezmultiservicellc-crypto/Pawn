/**
 * xPawn (the shop's previous pawn system) → Pawn loans. PURE mapping: no
 * database, no file access, no clock. The loader script
 * (scripts/import-xpawn-loans.mjs) feeds it the rows of the Tickets, Items and
 * PawnPayments exports and stages what it returns.
 *
 * What an old ticket becomes
 *   Ticket (type 1-4)  → one loan. Type 0 is a BUY — not a loan, not mapped here.
 *   Item               → one loan_collateral_items row.
 *   Payment (status A) → one 'payment' event, followed by
 *                          'extension'  when it moved the due date (type 1),
 *                          'redemption' when it closed the ticket (type 3).
 *   Ticket closed P    → a 'forfeiture' event; closed V → a 'void' event.
 *
 * Rules worth knowing before changing anything
 *   - Money is never recomputed. Principal, interest and fees are what the old
 *     system recorded. Only the RATE is derived (period charge ÷ amount).
 *   - A period charge of exactly the minimum on a small loan is the statutory
 *     minimum charge, not a rate: it maps to the ticket type's rate plus
 *     min_monthly_charge. The caps themselves are enforced by the database
 *     (loans_enforce_jurisdiction); `rateCap` / `minChargeCap` are passed in
 *     from the tenant's jurisdiction, never constants here.
 *   - Voided payments are left out: they net to nothing.
 *   - A voided ticket keeps its number only if its original amount survives in
 *     the old note ("Original amount $200.00 Voided by ..."). An empty void
 *     has no principal and cannot be a loan.
 *   - Dates in the exports are the SHOP's wall clock. Day values are taken in
 *     the shop's timezone, never UTC.
 */

export type XRow = Record<string, unknown>

export type XpawnOptions = {
  /** tenants.timezone */
  timezone: string
  /** jurisdictions.rate_cap_monthly (null = no cap) */
  rateCap: number | null
  /** jurisdictions.min_charge_cap (null = no minimum-charge rule) */
  minChargeCap: number | null
  /** Old customer keys that must not be imported (the old system's test record). */
  skipCustomerKeys?: ReadonlySet<number>
}

export type StagedLoan = {
  legacy_key: number
  customer_key: number
  pickup_customer_key: number | null
  ticket_number: string
  principal: number
  rate: number
  min_charge: number | null
  issue_date: string
  due_date: string
  status: 'active' | 'extended' | 'partial_paid' | 'redeemed' | 'forfeited' | 'voided'
  created_at: string
  updated_at: string
  notes: string | null
}

export type StagedEvent = {
  legacy_ref: string
  ticket_key: number
  event_type: 'issued' | 'payment' | 'extension' | 'redemption' | 'forfeiture' | 'void'
  amount: number | null
  principal_paid: number
  interest_paid: number
  fees_paid: number
  payment_method: 'cash' | 'card' | 'other' | null
  new_due_date: string | null
  notes: string | null
  occurred_at: string
}

export type StagedItem = {
  legacy_key: number
  ticket_key: number
  position: number
  description: string
  category: string
  metal_type: string | null
  karat: number | null
  weight_grams: number | null
  est_value: number
  jewelry_size: string | null
  color: string | null
  gemstone_description: string | null
  unique_marks: string | null
  pawn_category_slug: string | null
  pawn_subcategory_slug: string | null
  firearm_type: string | null
  firearm_make: string | null
  firearm_model: string | null
  firearm_caliber: string | null
  firearm_serial_number: string | null
  firearm_action_type: string | null
  firearm_finish: string | null
  electronic_brand: string | null
  electronic_model: string | null
  electronic_serial: string | null
  tool_brand: string | null
  tool_model: string | null
  created_at: string | null
}

export type SkipReason = 'buy' | 'test_customer' | 'no_amount' | 'bad_date'

export type MapLoanResult =
  | { ok: true; loan: StagedLoan; events: StagedEvent[]; warnings: string[] }
  | { ok: false; reason: SkipReason }

// ── small helpers ──────────────────────────────────────────────────────────

const r4 = (n: number): number => Math.round(n * 10000) / 10000
const r2 = (n: number): number => Math.round(n * 100) / 100
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[$,\s]/g, ''))
  return Number.isFinite(n) ? n : 0
}
export const text = (v: unknown): string | null => {
  if (v == null) return null
  const s = String(v).replace(/\s+/g, ' ').trim()
  return s === '' ? null : s
}
const usd = (n: number): string => `$${r2(n).toFixed(2)}`

/** An instant from the export (ISO string or Date) as ISO, or null. */
export function instant(v: unknown): string | null {
  if (v == null || v === '') return null
  const d = v instanceof Date ? v : new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/**
 * A calendar day in the shop's timezone. Accepts the export's text dates
 * ("7/15/2004", "9 /13/2004", "7/11/2013 1:22:48 PM" — already shop wall
 * clock) and instants (ISO / Date — converted to the shop's day).
 */
export function shopDate(v: unknown, timezone: string): string | null {
  if (v == null || v === '') return null
  if (typeof v === 'string') {
    const m = /^\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})/.exec(v)
    if (m) {
      const mo = Number(m[1])
      const d = Number(m[2])
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
      return `${m[3]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    }
  }
  const iso = instant(v)
  if (!iso) return null
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
}

/** The rate each old ticket type was written at; used only to tell a minimum charge from a rate. */
const TYPE_BASE_RATE: Record<number, number> = { 1: 0.2, 2: 0.1, 3: 0.15, 4: 0.05 }

export type RateResult = { rate: number; minCharge: number | null; note: string | null }

/**
 * Period charge → monthly rate (+ minimum charge).
 *   exact      charge ÷ amount is a 4-decimal rate within the cap
 *   minimum    the charge IS the statutory minimum and the type's rate would
 *              charge less → type rate + min_monthly_charge
 *   otherwise  nearest 4-decimal rate, capped, with the old charge kept in a note
 */
export function rateFromCharge(
  ticketType: number,
  amount: number,
  periodCharge: number,
  opts: Pick<XpawnOptions, 'rateCap' | 'minChargeCap'>,
): RateResult {
  if (!(amount > 0) || periodCharge <= 0) return { rate: 0, minCharge: null, note: null }
  const raw = periodCharge / amount
  const rounded = r4(raw)
  const cap = opts.rateCap
  const base = TYPE_BASE_RATE[ticketType]
  // The minimum first: $5 on $40 divides cleanly (12.5%) but is the minimum
  // charge on a 10% ticket, and both readings charge the same $5.
  if (
    opts.minChargeCap != null &&
    base != null &&
    Math.abs(periodCharge - opts.minChargeCap) < 0.005 &&
    base * amount < periodCharge - 0.005
  ) {
    return { rate: base, minCharge: r4(periodCharge), note: null }
  }
  const exact = Math.abs(rounded * amount - periodCharge) < 0.005
  if (exact && (cap == null || rounded <= cap + 0.00005)) return { rate: rounded, minCharge: null, note: null }
  const capped = cap != null && rounded > cap ? cap : rounded
  return {
    rate: capped,
    minCharge: null,
    note: `Old system charge per period: ${usd(periodCharge)}`,
  }
}

/** "Original amount $200.00 Voided by ER 7/20/2026" → 200 */
export function originalAmountFromNote(note: unknown): number | null {
  const m = /Original amount \$([\d,]+(?:\.\d+)?)/i.exec(String(note ?? ''))
  if (!m) return null
  const n = Number(m[1].replace(/,/g, ''))
  return n > 0 ? n : null
}

// ── tickets + payments → loan + events ─────────────────────────────────────

const PAYMENT_PART_KEYS = [
  'Interest Charge Paid',
  'Accumulated Charges Paid',
  'Principal paid',
  'Lost Ticket fee paid',
] as const

function paymentEvents(ticketKey: number, p: XRow, timezone: string): StagedEvent[] {
  const key = num(p['Key'])
  const at = instant(p['Payment Date']) ?? instant(p['CreationTimestamp'])
  if (!at) return []
  const type = num(p['Payment Type'])
  const interestRaw = num(p['Interest Charge Paid']) + num(p['Accumulated Charges Paid'])
  const principalRaw = num(p['Principal paid'])
  const feesRaw = num(p['Lost Ticket fee paid'])
  const net = num(p['Net Payment'])
  const negative = PAYMENT_PART_KEYS.some((k) => num(p[k]) < 0)
  const parts = r4(Math.max(0, interestRaw) + Math.max(0, principalRaw) + Math.max(0, feesRaw))
  const credits = num(p['Credits'])
  const card = num(p['Cred.Card']) + num(p['Deb.Card'])

  const notes: string[] = []
  // What the customer handed over is the amount, except when a credit on
  // account paid the charges: then the amount is what was applied.
  let amount = r4(net)
  let method: StagedEvent['payment_method'] = card > 0 ? 'card' : 'cash'
  if (type === 5) {
    notes.push('Credit left on account (old system)')
  } else if (negative) {
    notes.push(
      `Old system adjustment: interest ${usd(interestRaw)}, principal ${usd(principalRaw)}, paid ${usd(net)}`,
    )
  } else if (Math.abs(parts - net) > 0.011) {
    amount = parts
    if (credits < 0 && net === 0) method = 'other'
    notes.push(`Old system credit used: ${usd(Math.abs(credits))}; cash paid ${usd(net)}`)
  }
  const operator = text(p['OperatorInitials'])
  const oldNote = text(p['Note'])
  if (oldNote) notes.push(oldNote)
  if (operator) notes.push(`By ${operator}`)

  const events: StagedEvent[] = [
    {
      legacy_ref: `xpawn:pay:${key}`,
      ticket_key: ticketKey,
      event_type: 'payment',
      amount,
      principal_paid: r4(Math.max(0, principalRaw)),
      interest_paid: r4(Math.max(0, interestRaw)),
      fees_paid: r4(Math.max(0, feesRaw)),
      payment_method: method,
      new_due_date: null,
      notes: notes.length ? notes.join(' · ') : null,
      occurred_at: at,
    },
  ]
  // The follow-up row sorts right after its payment.
  const after = new Date(new Date(at).getTime() + 1000).toISOString()
  if (type === 1) {
    const newDue = shopDate(p['New Due Date'], timezone)
    const oldDue = shopDate(p['Old Due Date'], timezone)
    if (newDue && (!oldDue || newDue > oldDue)) {
      events.push({
        legacy_ref: `xpawn:pay:${key}:ext`,
        ticket_key: ticketKey,
        event_type: 'extension',
        amount: null,
        principal_paid: 0,
        interest_paid: 0,
        fees_paid: 0,
        payment_method: null,
        new_due_date: newDue,
        notes: operator ? `By ${operator}` : null,
        occurred_at: after,
      })
    }
  } else if (type === 3) {
    events.push({
      legacy_ref: `xpawn:pay:${key}:red`,
      ticket_key: ticketKey,
      event_type: 'redemption',
      amount: null,
      principal_paid: 0,
      interest_paid: 0,
      fees_paid: 0,
      payment_method: null,
      new_due_date: null,
      notes: operator ? `By ${operator}` : null,
      occurred_at: after,
    })
  }
  return events
}

/**
 * One old ticket (+ its payments, any status) → a staged loan and its events.
 */
export function mapLoan(ticket: XRow, payments: ReadonlyArray<XRow>, opts: XpawnOptions): MapLoanResult {
  const type = num(ticket['Ticket Type'])
  if (type === 0) return { ok: false, reason: 'buy' }
  const key = num(ticket['Ticket Key'])
  const customerKey = num(ticket['Customer Key'])
  if (opts.skipCustomerKeys?.has(customerKey)) return { ok: false, reason: 'test_customer' }

  const oldStatus = String(ticket['Status'] ?? '').trim()
  const oldNote = text(ticket['Notes'])
  let principal = num(ticket['Amount'])
  if (!(principal > 0) && oldStatus === 'V') principal = originalAmountFromNote(oldNote) ?? 0
  if (!(principal > 0)) return { ok: false, reason: 'no_amount' }

  const issue = shopDate(ticket['Issue Date'], opts.timezone)
  const due = shopDate(ticket['Due Date'], opts.timezone)
  const created = instant(ticket['Creation Timestamp'])
  if (!issue || !due || !created) return { ok: false, reason: 'bad_date' }

  const warnings: string[] = []
  const rate = rateFromCharge(type, principal, num(ticket['Standard RE']), opts)
  if (rate.note) warnings.push('rate_approximated')

  const live = payments
    .filter((p) => String(p['PaymentStatus'] ?? '').trim() === 'A')
    .slice()
    .sort((a, b) => {
      const ta = instant(a['Payment Date']) ?? ''
      const tb = instant(b['Payment Date']) ?? ''
      return ta < tb ? -1 : ta > tb ? 1 : num(a['Key']) - num(b['Key'])
    })

  const events: StagedEvent[] = [
    {
      legacy_ref: `xpawn:ticket:${key}:issued`,
      ticket_key: key,
      event_type: 'issued',
      amount: r4(principal),
      principal_paid: 0,
      interest_paid: 0,
      fees_paid: 0,
      payment_method: null,
      new_due_date: null,
      notes: null,
      occurred_at: created,
    },
  ]
  for (const p of live) events.push(...paymentEvents(key, p, opts.timezone))

  const closedAt =
    instant(ticket['TicketStatusDate']) ?? instant(ticket['Date Closed']) ?? instant(ticket['Update Timestamp'])
  const howClosed = text(ticket['How closed'])
  const closing = (event_type: StagedEvent['event_type'], notes: string | null): StagedEvent => ({
    legacy_ref: `xpawn:ticket:${key}:${event_type}`,
    ticket_key: key,
    event_type,
    amount: null,
    principal_paid: 0,
    interest_paid: 0,
    fees_paid: 0,
    payment_method: null,
    new_due_date: null,
    notes,
    // Never before the last recorded event of the ticket.
    occurred_at: laterOf(closedAt ?? created, events[events.length - 1].occurred_at),
  })

  let status: StagedLoan['status']
  if (oldStatus === 'V') {
    status = 'voided'
    events.push(closing('void', oldNote))
  } else if (oldStatus === 'P') {
    status = 'forfeited'
    events.push(closing('forfeiture', howClosed ? `Old system: ${howClosed}` : null))
  } else if (oldStatus === 'X') {
    status = 'redeemed'
    if (!events.some((e) => e.event_type === 'redemption')) events.push(closing('redemption', null))
  } else {
    const principalPaid = events.reduce((s, e) => s + e.principal_paid, 0)
    status = principalPaid > 0 ? 'partial_paid' : events.some((e) => e.event_type === 'extension') ? 'extended' : 'active'
  }

  const noteLines: string[] = []
  if (oldNote && oldStatus !== 'V') noteLines.push(oldNote)
  if (rate.note) noteLines.push(rate.note)
  const codes = text(ticket['Codes'])
  if (codes && /POLICE/i.test(codes)) noteLines.push('Old system code: POLICE')
  const operator = text(ticket['OperatorInitials'])
  noteLines.push(`Imported from the old pawn system (ticket type ${type}${operator ? `, written by ${operator}` : ''}).`)

  const terminal = status === 'redeemed' || status === 'forfeited' || status === 'voided'
  const pickup = num(ticket['Pickup Customer Key'])
  return {
    ok: true,
    warnings,
    events,
    loan: {
      legacy_key: key,
      customer_key: customerKey,
      pickup_customer_key: pickup > 0 ? pickup : null,
      ticket_number: String(ticket['Ticket No'] ?? '').trim(),
      principal: r4(principal),
      rate: rate.rate,
      min_charge: rate.minCharge,
      issue_date: issue,
      due_date: due,
      status,
      created_at: created,
      // A closed loan's last change is its closing — the record-retention
      // clock and the lifecycle messages both read loans.updated_at.
      updated_at: terminal
        ? events[events.length - 1].occurred_at
        : laterOf(instant(ticket['Update Timestamp']) ?? created, events[events.length - 1].occurred_at),
      notes: noteLines.join('\n'),
    },
  }
}

function laterOf(a: string, b: string): string {
  return a >= b ? a : b
}

// ── items → collateral ─────────────────────────────────────────────────────

type CategoryMap = { category: string; slug: string | null; sub: string | null; kind: 'jewelry' | 'firearm' | 'electronic' | 'tool' | 'other' }

const J = (category: string, sub: string | null): CategoryMap => ({ category, slug: 'jewelry', sub, kind: 'jewelry' })
const E = (sub: string | null): CategoryMap => ({ category: 'electronics', slug: 'electronics', sub, kind: 'electronic' })
const TL = (sub: string | null): CategoryMap => ({ category: 'tool', slug: 'tools', sub, kind: 'tool' })
const F = (sub: string | null): CategoryMap => ({ category: 'other', slug: 'firearms', sub, kind: 'firearm' })

const CATEGORY: Record<string, CategoryMap> = {
  RING: J('ring', 'rings'),
  BRAC: J('bracelet', 'bracelets'),
  ANKLET: J('bracelet', 'bracelets'),
  CHAIN: J('chain', 'chains'),
  'CHAIN W/ CHARM': J('chain', 'chains'),
  CHARM: J('pendant', 'pendants'),
  PEND: J('pendant', 'pendants'),
  EAR: J('earrings', 'earrings'),
  NECK: J('necklace', 'chains'),
  WATCH: J('watch', 'watches'),
  SCRAP: J('other', null),
  COIN: { category: 'coin', slug: 'jewelry', sub: null, kind: 'jewelry' },
  HANDGUN: F('handguns'),
  RIFLE: F('rifles'),
  SHOTGUN: F('shotguns'),
  COMPUTER: E('laptops'),
  CELL: E('phones'),
  TELEVISION: E('tvs'),
  'VIDEO GAMES': E('consoles'),
  ELECTRONIC: E(null),
  DVD: E(null),
  'DVD PLAYER': E(null),
  'PHOTO-CAMERA': E(null),
  VIDEO: E(null),
  TOOL: TL(null),
  'MISC TOOLS': TL(null),
  DRILL: TL('power_tools'),
  INSTRUMENT: { category: 'instrument', slug: 'general', sub: null, kind: 'other' },
}
const OTHER: CategoryMap = { category: 'other', slug: 'general', sub: null, kind: 'other' }

export function mapCategory(code: unknown): CategoryMap {
  return CATEGORY[String(code ?? '').trim().toUpperCase()] ?? OTHER
}

/** "14k" → 14; "750" → 18; junk ("00k", "0 k", "ed") → null. */
export function parseKarat(v: unknown): number | null {
  const s = String(v ?? '').trim().toLowerCase()
  const k = /^(\d{1,2})\s?k$/.exec(s)
  if (k) {
    const n = Number(k[1])
    return n >= 8 && n <= 24 ? n : null
  }
  const fineness: Record<string, number> = { '417': 10, '585': 14, '750': 18, '916': 22, '999': 24 }
  return fineness[s] ?? null
}

export function mapMetal(colorText: unknown, karatText: unknown): string | null {
  const c = String(colorText ?? '').trim().toLowerCase()
  const k = String(karatText ?? '').trim().toLowerCase()
  if (c.includes('white gold')) return 'white_gold'
  if (c.includes('rose')) return 'rose_gold'
  if (c.includes('two tone') || c.includes('tri-color') || c.includes('tri color')) return 'mixed'
  if (c.includes('silver') || k === '925') return 'silver'
  if (c.includes('stainless')) return 'stainless_steel'
  if (c.includes('platinum') || k === 'pla') return 'platinum'
  if (c.includes('yellow') || c === 'gold') return 'gold'
  return parseKarat(karatText) != null ? 'gold' : null
}

const GRAMS_PER_DWT = 1.55517384

export function weightGrams(weight: unknown, unit: unknown): number | null {
  const w = num(weight)
  if (!(w > 0)) return null
  const u = String(unit ?? '').trim().toLowerCase()
  return r4(u === 'dwt' ? w * GRAMS_PER_DWT : w)
}

function stoneText(qty: unknown, type: unknown, color: unknown, cut: unknown): string | null {
  const t = text(type)
  if (!t) return null
  const q = num(qty)
  return [q > 0 ? String(q) : null, text(color), t, text(cut)].filter(Boolean).join(' ')
}

/**
 * Items come as arrays because the export repeats header names (two stones
 * each have Qty / Type / Color / ...). `col(name, nth)` resolves the nth
 * column with that name.
 */
export function makeItemMapper(header: ReadonlyArray<string>) {
  const col = (name: string, nth = 0): number => {
    let seen = -1
    for (let i = 0; i < header.length; i++) if (header[i] === name && ++seen === nth) return i
    return -1
  }
  const c = {
    key: col('Item Key'),
    ticket: col('Ticket Key'),
    cat: col('Category Code'),
    pub: col('Public Description'),
    priv: col('Private Description'),
    no: col('Item No.'),
    qty: col('Quantity'),
    serial: col('Serial No'),
    mfg: col('Mfg'),
    model: col('Model'),
    cost: col('Cost'),
    size: col('Size'),
    weight: col('Weight'),
    unit: col('Units of weight'),
    karat: col('Karat'),
    finish: col('Finish'),
    caliber: col('Caliber'),
    action: col('Action'),
    marks: col('Marks'),
    metalColor: col('Misc 1'),
    s1qty: col('Qty', 0),
    s1type: col('Type', 0),
    s1color: col('Color', 1),
    s1cut: col('Cut', 0),
    s2qty: col('Qty', 1),
    s2type: col('Type', 1),
    s2color: col('Color', 2),
    s2cut: col('Cut', 1),
    otherStones: col('OtherStones'),
    created: col('CreationTimestamp'),
  }
  return function mapItem(row: ReadonlyArray<unknown>, position: number): StagedItem {
    const at = (i: number): unknown => (i >= 0 ? row[i] : null)
    const cat = mapCategory(at(c.cat))
    const qty = num(at(c.qty))
    const pub = text(at(c.pub))
    const priv = text(at(c.priv))
    const description =
      [qty > 1 ? `${qty} ×` : null, pub ?? text(at(c.cat)) ?? 'Item', priv ? `— ${priv}` : null].filter(Boolean).join(' ')
    const metalColor = text(at(c.metalColor))
    const stones = [
      stoneText(at(c.s1qty), at(c.s1type), at(c.s1color), at(c.s1cut)),
      stoneText(at(c.s2qty), at(c.s2type), at(c.s2color), at(c.s2cut)),
      text(at(c.otherStones)),
    ].filter(Boolean)
    const jewelry = cat.kind === 'jewelry'
    const firearm = cat.kind === 'firearm' || (text(at(c.caliber)) != null && cat.kind === 'other')
    const firearmType =
      cat.sub === 'handguns' ? 'handgun' : cat.sub === 'rifles' ? 'rifle' : cat.sub === 'shotguns' ? 'shotgun' : 'other'
    const mfg = text(at(c.mfg))
    const model = text(at(c.model))
    const serial = text(at(c.serial))
    return {
      legacy_key: num(at(c.key)),
      ticket_key: num(at(c.ticket)),
      position,
      description,
      category: cat.category,
      metal_type: jewelry ? mapMetal(metalColor, at(c.karat)) : null,
      karat: jewelry ? parseKarat(at(c.karat)) : null,
      weight_grams: jewelry ? weightGrams(at(c.weight), at(c.unit)) : null,
      est_value: r4(Math.max(0, num(at(c.cost)))),
      jewelry_size: jewelry ? text(at(c.size)) : null,
      color: jewelry && metalColor && !/^(other|n\/a)$/i.test(metalColor) ? metalColor : null,
      gemstone_description: stones.length ? stones.join('; ') : null,
      unique_marks: text(at(c.marks)),
      pawn_category_slug: firearm ? 'firearms' : cat.slug,
      pawn_subcategory_slug: cat.sub,
      firearm_type: firearm ? firearmType : null,
      firearm_make: firearm ? mfg : null,
      firearm_model: firearm ? model : null,
      firearm_caliber: firearm ? text(at(c.caliber)) : null,
      firearm_serial_number: firearm ? serial : null,
      firearm_action_type: firearm ? text(at(c.action)) : null,
      firearm_finish: firearm ? text(at(c.finish)) : null,
      electronic_brand: cat.kind === 'electronic' ? mfg : null,
      electronic_model: cat.kind === 'electronic' ? model : null,
      electronic_serial: cat.kind === 'electronic' ? serial : null,
      tool_brand: cat.kind === 'tool' ? mfg : null,
      tool_model: cat.kind === 'tool' ? model : null,
      created_at: instant(at(c.created)),
    }
  }
}
