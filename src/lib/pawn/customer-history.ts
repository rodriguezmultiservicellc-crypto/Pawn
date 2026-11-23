/**
 * A customer's pawn history, for the clerk writing a new ticket: how many
 * tickets, how many picked up, how many lost — and the pieces they picked
 * up before, because a regular brings the same chain back.
 *
 * Pure: loans and collateral rows in, the summary out.
 *
 *   picked up = redeemed        lost = forfeited
 *   open      = active, extended, partial_paid
 * A voided ticket never happened: it is counted on its own and left out of
 * the totals.
 *
 * `previous_items` are the pieces of REDEEMED tickets only — a forfeited
 * piece is the shop's now and cannot come back across the counter. The same
 * piece pawned five times is one entry (newest value, times counted).
 */

export type HistoryLoanInput = {
  id: string
  ticket_number: string | null
  status: string
  principal: number | string
  issue_date: string
}

export type HistoryItemInput = {
  loan_id: string
  position: number
  description: string
  category: string
  metal_type: string | null
  karat: number | string | null
  weight_grams: number | string | null
  est_value: number | string | null
  jewelry_size: string | null
  color: string | null
  gemstone_description: string | null
  unique_marks: string | null
  pawn_category_slug: string | null
  pawn_subcategory_slug: string | null
  firearm_make: string | null
  firearm_model: string | null
  firearm_caliber: string | null
  firearm_serial_number: string | null
  firearm_type: string | null
  electronic_brand: string | null
  electronic_model: string | null
  electronic_serial: string | null
  tool_brand: string | null
  tool_model: string | null
}

export type HistoryOutcome = 'open' | 'redeemed' | 'forfeited' | 'voided'

/** A piece the customer pawned and picked up — enough to write it again. */
export type PreviousPawnItem = Omit<HistoryItemInput, 'loan_id' | 'position' | 'karat' | 'weight_grams' | 'est_value'> & {
  key: string
  /** "10k Figaro chain 23.6g" */
  label: string
  karat: number | null
  weight_grams: number | null
  /** What was lent on it the last time. */
  last_value: number
  last_date: string
  last_ticket: string
  /** How many redeemed tickets carried it. */
  times: number
}

export type HistoryTicket = {
  loan_id: string
  ticket_number: string
  issue_date: string
  outcome: HistoryOutcome
  principal: number
  /** Labels of its pieces, in ticket order. */
  items: string[]
}

export type CustomerPawnHistory = {
  /** Tickets that happened (voided left out). */
  total: number
  open: number
  redeemed: number
  forfeited: number
  voided: number
  open_principal: number
  first_date: string | null
  /** Newest first, capped. */
  recent: HistoryTicket[]
  /** Newest first, capped. */
  previous_items: PreviousPawnItem[]
}

export const HISTORY_RECENT_MAX = 12
export const HISTORY_ITEMS_MAX = 10

const num = (v: number | string | null): number | null => {
  if (v == null || v === '') return null
  const x = Number(v)
  return Number.isFinite(x) && x > 0 ? x : null
}

export function outcomeOf(status: string): HistoryOutcome {
  if (status === 'redeemed') return 'redeemed'
  if (status === 'forfeited') return 'forfeited'
  if (status === 'voided') return 'voided'
  return 'open'
}

/** "10k Figaro chain 23.6g" — karat, what it is, weight. */
export function pawnItemLabel(item: {
  description: string
  karat: number | string | null
  weight_grams: number | string | null
}): string {
  const k = num(item.karat)
  const w = num(item.weight_grams)
  const desc = item.description.trim()
  // "10k chain" already says its karat.
  const saysKarat = k != null && new RegExp(`\\b${Number(k.toFixed(1))}\\s?k`, 'i').test(desc)
  return [k != null && !saysKarat ? `${Number(k.toFixed(1))}k` : null, desc, w != null ? `${Number(w.toFixed(2))}g` : null]
    .filter(Boolean)
    .join(' ')
}

function pieceKey(it: HistoryItemInput): string {
  const w = num(it.weight_grams)
  return [
    it.description.trim().toLowerCase().replace(/\s+/g, ' '),
    num(it.karat) ?? '',
    w == null ? '' : w.toFixed(1),
    (it.firearm_serial_number ?? it.electronic_serial ?? '').trim().toLowerCase(),
  ].join('|')
}

export function buildCustomerPawnHistory(args: {
  loans: ReadonlyArray<HistoryLoanInput>
  items: ReadonlyArray<HistoryItemInput>
}): CustomerPawnHistory {
  const loans = args.loans.slice().sort((a, b) => (a.issue_date < b.issue_date ? 1 : a.issue_date > b.issue_date ? -1 : 0))
  const byLoan = new Map<string, HistoryItemInput[]>()
  for (const it of args.items) {
    const list = byLoan.get(it.loan_id)
    if (list) list.push(it)
    else byLoan.set(it.loan_id, [it])
  }
  for (const list of byLoan.values()) list.sort((a, b) => a.position - b.position)

  const h: CustomerPawnHistory = {
    total: 0,
    open: 0,
    redeemed: 0,
    forfeited: 0,
    voided: 0,
    open_principal: 0,
    first_date: null,
    recent: [],
    previous_items: [],
  }
  const pieces = new Map<string, PreviousPawnItem>()

  for (const l of loans) {
    const outcome = outcomeOf(l.status)
    h[outcome] += 1
    const items = byLoan.get(l.id) ?? []
    if (h.recent.length < HISTORY_RECENT_MAX) {
      h.recent.push({
        loan_id: l.id,
        ticket_number: l.ticket_number ?? '',
        issue_date: l.issue_date,
        outcome,
        principal: Number(l.principal),
        items: items.map(pawnItemLabel),
      })
    }
    if (outcome === 'voided') continue
    h.total += 1
    if (outcome === 'open') h.open_principal += Number(l.principal)
    if (!h.first_date || l.issue_date < h.first_date) h.first_date = l.issue_date
    if (outcome !== 'redeemed') continue
    // Loans run newest first, so the first sighting of a piece is its latest.
    for (const it of items) {
      const key = pieceKey(it)
      const seen = pieces.get(key)
      if (seen) {
        seen.times += 1
        continue
      }
      const { loan_id: _loan, position: _pos, karat, weight_grams, est_value, ...rest } = it
      void _loan
      void _pos
      pieces.set(key, {
        ...rest,
        key,
        label: pawnItemLabel(it),
        karat: num(karat),
        weight_grams: num(weight_grams),
        last_value: num(est_value) ?? 0,
        last_date: l.issue_date,
        last_ticket: l.ticket_number ?? '',
        times: 1,
      })
    }
  }
  h.open_principal = Math.round(h.open_principal * 100) / 100
  h.previous_items = [...pieces.values()].slice(0, HISTORY_ITEMS_MAX)
  return h
}
