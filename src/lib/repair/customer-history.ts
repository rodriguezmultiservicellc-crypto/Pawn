/**
 * A customer's repair history, beside the picked customer on New repair
 * ticket: how many repairs, how many are still in the shop, how many are
 * ready and waiting, picked up, abandoned — and the recent tickets.
 *
 * Pure: ticket rows in, the summary out.
 *   still here = any status but picked_up / abandoned / voided
 *   ready      = status ready (counted in "still here" too)
 * A voided ticket never happened: counted on its own, left out of totals.
 */

export type RepairHistoryInput = {
  id: string
  ticket_number: string | null
  status: string
  title: string | null
  item_description: string | null
  quote_amount: number | string | null
  balance_due: number | string | null
  created_at: string
}

export type RepairHistoryTicket = {
  id: string
  ticket_number: string
  created_at: string
  status: string
  quote: number | null
  title: string
}

export type CustomerRepairHistory = {
  total: number
  open: number
  ready: number
  picked_up: number
  abandoned: number
  voided: number
  /** Balance left on the tickets still in the shop. */
  open_balance: number
  first_date: string | null
  /** Newest first, capped. */
  recent: RepairHistoryTicket[]
}

export const REPAIR_HISTORY_RECENT_MAX = 12

const CLOSED = new Set(['picked_up', 'abandoned', 'voided'])

export function buildCustomerRepairHistory(
  tickets: ReadonlyArray<RepairHistoryInput>,
): CustomerRepairHistory {
  const rows = tickets.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
  const h: CustomerRepairHistory = {
    total: 0,
    open: 0,
    ready: 0,
    picked_up: 0,
    abandoned: 0,
    voided: 0,
    open_balance: 0,
    first_date: null,
    recent: [],
  }
  for (const r of rows) {
    if (h.recent.length < REPAIR_HISTORY_RECENT_MAX) {
      const q = r.quote_amount == null || r.quote_amount === '' ? null : Number(r.quote_amount)
      h.recent.push({
        id: r.id,
        ticket_number: r.ticket_number ?? '',
        created_at: r.created_at,
        status: r.status,
        quote: q != null && Number.isFinite(q) ? q : null,
        title: (r.title || r.item_description || '').trim(),
      })
    }
    if (r.status === 'voided') {
      h.voided += 1
      continue
    }
    h.total += 1
    if (r.status === 'picked_up') h.picked_up += 1
    else if (r.status === 'abandoned') h.abandoned += 1
    if (!CLOSED.has(r.status)) {
      h.open += 1
      if (r.status === 'ready') h.ready += 1
      const b = Number(r.balance_due ?? 0)
      if (Number.isFinite(b) && b > 0) h.open_balance += b
    }
    if (!h.first_date || r.created_at < h.first_date) h.first_date = r.created_at
  }
  h.open_balance = Math.round(h.open_balance * 100) / 100
  return h
}
