/**
 * A customer's purchases and layaways, beside the picked customer on New
 * sale: how many purchases, what they spent (returns taken off), how many
 * returns, layaways open and what is still owed on them — and the recent
 * sales with their pieces.
 *
 * Pure: sale, layaway and sale-line rows in, the summary out.
 *   purchase = a sale that went through: completed, partial_returned,
 *              fully_returned (open = not finished; voided = never happened)
 *   spent    = total − returned_total over purchases
 *   layaway  = its own row; a layaway sale shows the layaway's status
 */

export type SaleHistoryInput = {
  id: string
  sale_number: string | null
  sale_kind: string
  status: string
  total: number | string
  returned_total: number | string
  completed_at: string | null
  created_at: string
}

export type LayawayHistoryInput = {
  id: string
  sale_id: string
  status: string
  balance_remaining: number | string
}

export type SaleLineInput = { sale_id: string; position: number; description: string }

export type SalesHistoryRow = {
  id: string
  /** The layaway's id when this sale is a layaway (its page is the layaway). */
  layaway_id: string | null
  sale_number: string
  date: string
  kind: 'sale' | 'layaway'
  /** sale_status, or layaway_status for a layaway. */
  status: string
  total: number
  items: string[]
}

export type CustomerSalesHistory = {
  purchases: number
  spent: number
  returns: number
  layaways_active: number
  layaway_owed: number
  layaways_completed: number
  first_date: string | null
  /** Newest first, capped. */
  recent: SalesHistoryRow[]
}

export const SALES_HISTORY_RECENT_MAX = 12

const WENT_THROUGH = new Set(['completed', 'partial_returned', 'fully_returned'])

/** Newest first, by the day the sale went through (else when it was rung). */
export function salesNewestFirst<T extends Pick<SaleHistoryInput, 'completed_at' | 'created_at'>>(
  sales: ReadonlyArray<T>,
): T[] {
  const d = (s: T) => s.completed_at ?? s.created_at
  return sales.slice().sort((a, b) => (d(a) < d(b) ? 1 : d(a) > d(b) ? -1 : 0))
}

const money = (v: number | string | null | undefined): number => {
  const x = Number(v ?? 0)
  return Number.isFinite(x) ? x : 0
}

export function buildCustomerSalesHistory(args: {
  sales: ReadonlyArray<SaleHistoryInput>
  layaways: ReadonlyArray<LayawayHistoryInput>
  lines: ReadonlyArray<SaleLineInput>
}): CustomerSalesHistory {
  const dateOf = (s: SaleHistoryInput) => s.completed_at ?? s.created_at
  const sales = salesNewestFirst(args.sales)
  const layawayBySale = new Map(args.layaways.map((l) => [l.sale_id, l]))
  const linesBySale = new Map<string, SaleLineInput[]>()
  for (const l of args.lines) {
    const list = linesBySale.get(l.sale_id)
    if (list) list.push(l)
    else linesBySale.set(l.sale_id, [l])
  }

  const h: CustomerSalesHistory = {
    purchases: 0,
    spent: 0,
    returns: 0,
    layaways_active: 0,
    layaway_owed: 0,
    layaways_completed: 0,
    first_date: null,
    recent: [],
  }
  for (const l of args.layaways) {
    if (l.status === 'active') {
      h.layaways_active += 1
      h.layaway_owed += money(l.balance_remaining)
    } else if (l.status === 'completed') {
      h.layaways_completed += 1
    }
  }
  for (const s of sales) {
    const lay = layawayBySale.get(s.id) ?? null
    if (h.recent.length < SALES_HISTORY_RECENT_MAX) {
      h.recent.push({
        id: s.id,
        layaway_id: lay?.id ?? null,
        sale_number: s.sale_number ?? '',
        date: dateOf(s),
        kind: lay ? 'layaway' : 'sale',
        status: lay ? lay.status : s.status,
        total: money(s.total),
        items: (linesBySale.get(s.id) ?? [])
          .slice()
          .sort((a, b) => a.position - b.position)
          .map((l) => l.description.trim())
          .filter(Boolean),
      })
    }
    if (!WENT_THROUGH.has(s.status)) continue
    h.purchases += 1
    h.spent += money(s.total) - money(s.returned_total)
    if (money(s.returned_total) > 0) h.returns += 1
    if (!h.first_date || dateOf(s) < h.first_date) h.first_date = dateOf(s)
  }
  h.spent = Math.round(h.spent * 100) / 100
  h.layaway_owed = Math.round(h.layaway_owed * 100) / 100
  return h
}
