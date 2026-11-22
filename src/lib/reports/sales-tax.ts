/**
 * Sales tax — what a shop needs to file its sales tax return: sales before
 * tax, sales with no tax (by reason), tax collected by tax line (state,
 * county, ...), and the tax given back through returns and voids.
 *
 * Every number comes from what each sale KEPT when it was rung up
 * (sales.tax_amount, sales.tax_breakdown, sales.tax_exempt — patches/0095,
 * 0097), never from the shop's tax lines of today. A later change to a rate
 * does not rewrite a past period.
 *
 * When each thing counts (all in the shop's own day):
 *   a sale     the day it was COMPLETED. A layaway is completed when it is
 *              paid off; an open sale or layaway is not counted yet.
 *   a return   the day it was issued.
 *   a void     the day the sale was voided — but only for a sale completed
 *              BEFORE these dates (its tax was counted in an earlier
 *              period, so this period gives it back). A sale completed and
 *              voided inside the same dates is left out altogether, and so
 *              are its returns.
 * Cut time into periods any way: a voided sale nets to zero across them and
 * every other sale counts exactly once.
 *
 * A sale with no split kept (a rate typed at the counter, an online order,
 * a sale made before 0095) is listed under its one rate.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { allocateDiscount, parseTaxBreakdown, TAX_LEVELS, type SaleTaxPart } from '@/lib/pos/sales-tax'
import { reportBounds } from './range'
import type { ReportRange } from './types'

// ── What the calculation reads ────────────────────────────────────────────

export type TaxSaleInput = {
  id: string
  tenant_id: string
  sale_number: string | null
  status: string
  completed_at: string | null
  voided_at: string | null
  customer_name: string | null
  /** subtotal − discount: the sale before tax. */
  base: number
  /** The cart-level discount (needed to work out what each item sold for). */
  discount: number
  tax: number
  tax_rate: number
  exempt: { reason: string; certificate: string | null } | null
  /** sales.tax_breakdown, parsed. Empty = no split kept. */
  parts: SaleTaxPart[]
}

export type TaxSaleItemInput = { id: string; sale_id: string; quantity: number; line_total: number; position: number }

export type TaxReturnInput = {
  id: string
  sale_id: string
  return_number: string | null
  created_at: string
  /** Refund before tax. */
  subtotal: number
  tax: number
  items: ReadonlyArray<{ sale_item_id: string; quantity: number }>
}

// ── What it produces ──────────────────────────────────────────────────────

export type SalesTaxLine = {
  key: string
  name: string
  /** state | county | city | district | other; null for a sale with no split. */
  level: string | null
  rate: number
  /** True when the sales under it kept no split: one rate on the whole sale. */
  flat: boolean
  taxable: number
  tax: number
  refunded_taxable: number
  tax_refunded: number
  net_taxable: number
  net_tax: number
}

export type SalesTaxDocPart = { key: string; name: string; rate: number; taxable: number; tax: number }

/** One sale, return or void that feeds the report. A return or void carries negative amounts. */
export type SalesTaxDoc = {
  kind: 'sale' | 'return' | 'void'
  sale_id: string
  tenant_id: string
  /** The return number for a return; the sale number otherwise. */
  number: string
  sale_number: string
  at: string
  customer_name: string | null
  before_tax: number
  tax: number
  /** Set on a sale rung up tax exempt. */
  exempt_reason: string | null
  certificate: string | null
  /** A sale with no tax and no exemption recorded (tax set to 0 by hand). */
  untaxed: boolean
  parts: SalesTaxDocPart[]
}

export type SalesTaxNoTaxGroup = {
  /** resale | organization | ... ; null = no reason recorded. */
  reason: string | null
  count: number
  amount: number
}

export type SalesTaxReport = {
  totals: {
    sales: number
    gross: number
    exempt: number
    untaxed: number
    taxable: number
    tax_collected: number
    returns: number
    tax_refunded: number
    net_tax: number
  }
  lines: SalesTaxLine[]
  noTax: SalesTaxNoTaxGroup[]
  /** Newest first. */
  documents: SalesTaxDoc[]
}

// ── The calculation (pure) ────────────────────────────────────────────────

const cents = (dollars: number) => Math.round((Number(dollars) || 0) * 100)
const dollars = (c: number) => c / 100
const ms = (iso: string | null) => (iso ? new Date(iso).getTime() : NaN)

const lineKey = (p: Pick<SaleTaxPart, 'level' | 'name' | 'rate'>) => `${p.level}|${p.name}|${p.rate}`
const flatKey = (rate: number) => `flat|${rate}`

/**
 * Split `total` cents across `weights`, to the cent, adding up exactly:
 * largest remainders take the leftover cents. All-zero weights → all zero.
 */
export function distributeCents(total: number, weights: ReadonlyArray<number>): number[] {
  const sum = weights.reduce((a, w) => a + Math.max(0, w), 0)
  if (sum <= 0 || total === 0) return weights.map(() => 0)
  const exact = weights.map((w) => (total * Math.max(0, w)) / sum)
  const out = exact.map((x) => Math.floor(x))
  let left = total - out.reduce((a, b) => a + b, 0)
  const order = exact.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k].i] += 1
  return out
}

/**
 * What a return gives back on each tax line of its sale, in cents. Worked
 * out from what each returned item really sold for, so a tax that stopped
 * at part of an item's price (a per-item cap) gives back only what it took.
 * The tax amounts add up to the return's own tax.
 */
export function refundByTaxLine(
  sale: Pick<TaxSaleInput, 'discount' | 'parts'>,
  items: ReadonlyArray<TaxSaleItemInput>,
  ret: Pick<TaxReturnInput, 'tax' | 'items'>,
): { taxable: number[]; tax: number[] } {
  const parts = sale.parts
  const ordered = [...items].sort((a, b) => a.position - b.position)
  const net = allocateDiscount(ordered.map((i) => cents(i.line_total)), cents(sale.discount))
  const share = ordered.map((it) => {
    const back = ret.items.filter((r) => r.sale_item_id === it.id).reduce((a, r) => a + r.quantity, 0)
    return it.quantity > 0 ? Math.min(1, Math.max(0, back / it.quantity)) : 0
  })
  const rawTaxable = parts.map((p) => {
    let sum = 0
    for (let j = 0; j < ordered.length; j++) {
      let t = Math.max(0, net[j])
      if (p.item_cap != null) t = Math.min(t, Math.round(p.item_cap * 100 * ordered[j].quantity))
      sum += t * share[j]
    }
    return sum
  })
  let weights = rawTaxable.map((t, i) => t * parts[i].rate)
  // The items could not be matched (should not happen): fall back to the
  // sale's own proportions between its tax lines.
  if (weights.every((w) => w <= 0)) weights = parts.map((p) => Math.max(0, p.tax))
  return { taxable: rawTaxable.map((t) => Math.round(t)), tax: distributeCents(cents(ret.tax), weights) }
}

export function buildSalesTaxReport(input: {
  /** Every sale loaded: completed in the dates, voided in the dates, and the sales of the returns. */
  sales: ReadonlyArray<TaxSaleInput>
  /** Lines of the sales that have a return (only those are needed). */
  items: ReadonlyArray<TaxSaleItemInput>
  /** Issued returns: those made in the dates, and every return of a sale voided in the dates. */
  returns: ReadonlyArray<TaxReturnInput>
  fromIso: string
  toExclusiveIso: string
}): SalesTaxReport {
  const from = ms(input.fromIso)
  const to = ms(input.toExclusiveIso)
  const inRange = (iso: string | null) => {
    const t = ms(iso)
    return t >= from && t < to
  }
  const saleById = new Map(input.sales.map((s) => [s.id, s]))
  const itemsBySale = new Map<string, TaxSaleItemInput[]>()
  for (const it of input.items) itemsBySale.set(it.sale_id, [...(itemsBySale.get(it.sale_id) ?? []), it])

  type Acc = { name: string; level: string | null; rate: number; flat: boolean; taxable: number; tax: number; rTaxable: number; rTax: number }
  const lines = new Map<string, Acc>()
  const line = (key: string, seed: Pick<Acc, 'name' | 'level' | 'rate' | 'flat'>) => {
    let l = lines.get(key)
    if (!l) lines.set(key, (l = { ...seed, taxable: 0, tax: 0, rTaxable: 0, rTax: 0 }))
    return l
  }
  const partLine = (p: SaleTaxPart) => line(lineKey(p), { name: p.name, level: p.level, rate: p.rate, flat: false })
  const flatLine = (rate: number) => line(flatKey(rate), { name: '', level: null, rate, flat: true })

  /** What one return gives back per tax line of its sale: [key, name, rate, taxable¢, tax¢]. */
  const returnParts = (sale: TaxSaleInput, ret: TaxReturnInput): Array<[string, string, number, number, number]> => {
    if (sale.parts.length === 0) {
      return cents(ret.tax) !== 0 ? [[flatKey(sale.tax_rate), '', sale.tax_rate, cents(ret.subtotal), cents(ret.tax)]] : []
    }
    const by = refundByTaxLine(sale, itemsBySale.get(sale.id) ?? [], ret)
    return sale.parts.map((p, i) => [lineKey(p), p.name, p.rate, by.taxable[i], by.tax[i]])
  }

  const totals = { sales: 0, gross: 0, exempt: 0, untaxed: 0, tax: 0, returns: 0, refunded: 0 }
  const noTax = new Map<string | null, { count: number; amount: number }>()
  const documents: SalesTaxDoc[] = []

  // A sale completed in the dates counts — unless it was voided by their end.
  const leftOut = new Set<string>()
  for (const s of input.sales) {
    if (!inRange(s.completed_at)) continue
    if (s.status === 'voided' && !(ms(s.voided_at) >= to)) {
      leftOut.add(s.id)
      continue
    }
    const base = cents(s.base)
    const tax = cents(s.tax)
    const untaxed = !s.exempt && tax === 0 && base > 0
    totals.sales += 1
    totals.gross += base
    totals.tax += tax
    const parts: SalesTaxDocPart[] = []
    if (s.exempt || untaxed) {
      if (s.exempt) totals.exempt += base
      else totals.untaxed += base
      const reason = s.exempt ? s.exempt.reason : null
      const g = noTax.get(reason) ?? { count: 0, amount: 0 }
      noTax.set(reason, { count: g.count + 1, amount: g.amount + base })
    } else if (s.parts.length > 0) {
      for (const p of s.parts) {
        const l = partLine(p)
        l.taxable += cents(p.taxable)
        l.tax += cents(p.tax)
        parts.push({ key: lineKey(p), name: p.name, rate: p.rate, taxable: p.taxable, tax: p.tax })
      }
    } else if (tax !== 0) {
      const l = flatLine(s.tax_rate)
      l.taxable += base
      l.tax += tax
      parts.push({ key: flatKey(s.tax_rate), name: '', rate: s.tax_rate, taxable: dollars(base), tax: dollars(tax) })
    }
    documents.push({
      kind: 'sale',
      sale_id: s.id,
      tenant_id: s.tenant_id,
      number: s.sale_number ?? '',
      sale_number: s.sale_number ?? '',
      at: s.completed_at as string,
      customer_name: s.customer_name,
      before_tax: dollars(base),
      tax: dollars(tax),
      exempt_reason: s.exempt?.reason ?? null,
      certificate: s.exempt?.certificate ?? null,
      untaxed,
      parts,
    })
  }

  const giveBack = (
    kind: 'return' | 'void',
    sale: TaxSaleInput,
    number: string,
    at: string,
    baseCents: number,
    taxCents: number,
    byPart: Array<[string, string, number, number, number]>,
  ) => {
    totals.returns += baseCents
    totals.refunded += taxCents
    for (const [key, , , taxable, tax] of byPart) {
      const l = lines.get(key)
      // The line exists when the sale was counted in these dates; create it
      // for a sale counted in an earlier period.
      const target = l ?? (key.startsWith('flat|') ? flatLine(sale.tax_rate) : partLine(sale.parts.find((p) => lineKey(p) === key) as SaleTaxPart))
      target.rTaxable += taxable
      target.rTax += tax
    }
    documents.push({
      kind,
      sale_id: sale.id,
      tenant_id: sale.tenant_id,
      number,
      sale_number: sale.sale_number ?? '',
      at,
      customer_name: sale.customer_name,
      before_tax: -dollars(baseCents),
      tax: -dollars(taxCents),
      exempt_reason: sale.exempt?.reason ?? null,
      certificate: sale.exempt?.certificate ?? null,
      untaxed: false,
      parts: byPart
        .filter(([, , , taxable, tax]) => taxable !== 0 || tax !== 0)
        .map(([key, name, rate, taxable, tax]) => ({ key, name, rate, taxable: -dollars(taxable), tax: -dollars(tax) })),
    })
  }

  // A return counts the day it was issued — unless its sale was left out.
  for (const r of input.returns) {
    if (!inRange(r.created_at)) continue
    const sale = saleById.get(r.sale_id)
    if (!sale || leftOut.has(sale.id)) continue
    giveBack('return', sale, r.return_number ?? '', r.created_at, cents(r.subtotal), cents(r.tax), returnParts(sale, r))
  }

  // A void in the dates of a sale counted in an earlier period gives back
  // whatever its returns had not already given back.
  for (const s of input.sales) {
    if (s.status !== 'voided' || !inRange(s.voided_at)) continue
    if (!(ms(s.completed_at) < from)) continue
    const seed: Array<[string, string, number, number, number]> =
      s.parts.length > 0
        ? s.parts.map((p) => [lineKey(p), p.name, p.rate, cents(p.taxable), cents(p.tax)])
        : cents(s.tax) !== 0
          ? [[flatKey(s.tax_rate), '', s.tax_rate, cents(s.base), cents(s.tax)]]
          : []
    let base = cents(s.base)
    let tax = cents(s.tax)
    for (const r of input.returns) {
      if (r.sale_id !== s.id) continue
      base -= cents(r.subtotal)
      tax -= cents(r.tax)
      for (const [key, , , taxable, t] of returnParts(s, r)) {
        const at = seed.find((x) => x[0] === key)
        if (at) {
          at[3] = Math.max(0, at[3] - taxable)
          at[4] = Math.max(0, at[4] - t)
        }
      }
    }
    giveBack('void', s, s.sale_number ?? '', s.voided_at as string, Math.max(0, base), Math.max(0, tax), seed)
  }

  const levelRank = (l: string | null) => (l == null ? TAX_LEVELS.length : Math.max(0, TAX_LEVELS.indexOf(l as (typeof TAX_LEVELS)[number])))
  return {
    totals: {
      sales: totals.sales,
      gross: dollars(totals.gross),
      exempt: dollars(totals.exempt),
      untaxed: dollars(totals.untaxed),
      taxable: dollars(totals.gross - totals.exempt - totals.untaxed),
      tax_collected: dollars(totals.tax),
      returns: dollars(totals.returns),
      tax_refunded: dollars(totals.refunded),
      net_tax: dollars(totals.tax - totals.refunded),
    },
    lines: [...lines.entries()]
      .map(([key, l]) => ({
        key,
        name: l.name,
        level: l.level,
        rate: l.rate,
        flat: l.flat,
        taxable: dollars(l.taxable),
        tax: dollars(l.tax),
        refunded_taxable: dollars(l.rTaxable),
        tax_refunded: dollars(l.rTax),
        net_taxable: dollars(l.taxable - l.rTaxable),
        net_tax: dollars(l.tax - l.rTax),
      }))
      .sort((a, b) => levelRank(a.level) - levelRank(b.level) || a.name.localeCompare(b.name) || a.rate - b.rate),
    noTax: [...noTax.entries()]
      .map(([reason, g]) => ({ reason, count: g.count, amount: dollars(g.amount) }))
      // Recorded reasons first, largest first; "no reason" last.
      .sort((a, b) => Number(a.reason == null) - Number(b.reason == null) || b.amount - a.amount),
    documents: documents.sort((a, b) => ms(b.at) - ms(a.at)),
  }
}

// ── Loading ───────────────────────────────────────────────────────────────

type Client = SupabaseClient<Database>

const SALE_COLUMNS = `id, tenant_id, sale_number, status, subtotal, discount_amount, tax_amount, tax_rate,
  tax_breakdown, tax_exempt, tax_exempt_reason, tax_exempt_certificate, completed_at, voided_at,
  customer:customers(first_name, last_name)`

type SaleRow = {
  id: string
  tenant_id: string
  sale_number: string | null
  status: string
  subtotal: number | string
  discount_amount: number | string
  tax_amount: number | string
  tax_rate: number | string
  tax_breakdown: unknown
  tax_exempt: boolean
  tax_exempt_reason: string | null
  tax_exempt_certificate: string | null
  completed_at: string | null
  voided_at: string | null
  customer: { first_name: string; last_name: string } | null
}

function toSale(s: SaleRow): TaxSaleInput {
  const discount = Number(s.discount_amount)
  return {
    id: s.id,
    tenant_id: s.tenant_id,
    sale_number: s.sale_number,
    status: s.status,
    completed_at: s.completed_at,
    voided_at: s.voided_at,
    customer_name: s.customer ? `${s.customer.last_name}, ${s.customer.first_name}` : null,
    base: Math.max(0, Number(s.subtotal) - discount),
    discount,
    tax: Number(s.tax_amount),
    tax_rate: Number(s.tax_rate),
    exempt: s.tax_exempt ? { reason: s.tax_exempt_reason ?? 'other', certificate: s.tax_exempt_certificate } : null,
    parts: parseTaxBreakdown(s.tax_breakdown),
  }
}

const PAGE = 1000

/**
 * Every row of a query, 1,000 at a time. A tax report that stopped at the
 * API's default page would under-report without saying so.
 */
async function all<T>(
  what: string,
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1)
    if (error) throw new Error(`sales_tax_${what}_failed: ${error.message}`)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < PAGE) return out
  }
}

/** `ids` in groups small enough for one request each. */
function chunks<T>(ids: ReadonlyArray<T>, size = 150): T[][] {
  const out: T[][] = []
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size))
  return out
}

export async function getSalesTaxReport(args: {
  supabase: Client
  tenantIds: ReadonlyArray<string>
  range: ReportRange
}): Promise<SalesTaxReport> {
  const { supabase, range } = args
  const tenantIds = args.tenantIds as string[]
  // The shop's day, not UTC's.
  const { fromIso, toExclusiveIso } = reportBounds(range)
  const sales = () => supabase.from('sales').select(SALE_COLUMNS).in('tenant_id', tenantIds).is('deleted_at', null)
  const returns = () =>
    supabase
      .from('returns')
      .select('id, sale_id, return_number, created_at, subtotal, tax_amount')
      .in('tenant_id', tenantIds)
      .is('deleted_at', null)
      .eq('status', 'issued')
  type ReturnRow = { id: string; sale_id: string; return_number: string | null; created_at: string; subtotal: number | string; tax_amount: number | string }

  const [completed, voided, returnedNow] = await Promise.all([
    all<SaleRow>('sales', (a, b) =>
      sales()
        .in('status', ['completed', 'partial_returned', 'fully_returned', 'voided'])
        .gte('completed_at', fromIso)
        .lt('completed_at', toExclusiveIso)
        .order('completed_at', { ascending: true })
        .order('id', { ascending: true })
        .range(a, b),
    ),
    // Voided in the dates, counted in an earlier period.
    all<SaleRow>('voids', (a, b) =>
      sales()
        .eq('status', 'voided')
        .gte('voided_at', fromIso)
        .lt('voided_at', toExclusiveIso)
        .lt('completed_at', fromIso)
        .order('voided_at', { ascending: true })
        .order('id', { ascending: true })
        .range(a, b),
    ),
    all<ReturnRow>('returns', (a, b) =>
      returns()
        .gte('created_at', fromIso)
        .lt('created_at', toExclusiveIso)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(a, b),
    ),
  ])

  const saleRows = new Map<string, SaleRow>()
  for (const s of [...completed, ...voided]) saleRows.set(s.id, s)

  // Every return of a sale voided in the dates, whenever it was issued: the
  // void gives back only what those returns had not.
  const returnRows = new Map<string, ReturnRow>(returnedNow.map((r) => [r.id, r]))
  for (const ids of chunks(voided.map((s) => s.id))) {
    for (const r of await all<ReturnRow>('void_returns', (a, b) => returns().in('sale_id', ids).order('id', { ascending: true }).range(a, b))) {
      returnRows.set(r.id, r)
    }
  }

  // The sales those returns belong to, when not loaded already.
  const missing = [...new Set([...returnRows.values()].map((r) => r.sale_id))].filter((id) => !saleRows.has(id))
  for (const ids of chunks(missing)) {
    for (const s of await all<SaleRow>('return_sales', (a, b) => sales().in('id', ids).order('id', { ascending: true }).range(a, b))) {
      saleRows.set(s.id, s)
    }
  }

  // What came back on each return, and the lines of the sales concerned.
  type ReturnItemRow = { return_id: string; sale_item_id: string; quantity: number | string }
  const returnItems: ReturnItemRow[] = []
  for (const ids of chunks([...returnRows.keys()])) {
    returnItems.push(
      ...(await all<ReturnItemRow>('return_items', (a, b) =>
        supabase
          .from('return_items')
          .select('return_id, sale_item_id, quantity')
          .in('tenant_id', tenantIds)
          .in('return_id', ids)
          .is('deleted_at', null)
          .order('id', { ascending: true })
          .range(a, b),
      )),
    )
  }
  type ItemRow = { id: string; sale_id: string; quantity: number | string; line_total: number | string; position: number | null }
  const items: ItemRow[] = []
  for (const ids of chunks([...new Set([...returnRows.values()].map((r) => r.sale_id))])) {
    items.push(
      ...(await all<ItemRow>('sale_items', (a, b) =>
        supabase
          .from('sale_items')
          .select('id, sale_id, quantity, line_total, position')
          .in('tenant_id', tenantIds)
          .in('sale_id', ids)
          .is('deleted_at', null)
          .order('id', { ascending: true })
          .range(a, b),
      )),
    )
  }

  return buildSalesTaxReport({
    sales: [...saleRows.values()].map(toSale),
    items: items.map((i) => ({
      id: i.id,
      sale_id: i.sale_id,
      quantity: Number(i.quantity),
      line_total: Number(i.line_total),
      position: i.position ?? 0,
    })),
    returns: [...returnRows.values()].map((r) => ({
      id: r.id,
      sale_id: r.sale_id,
      return_number: r.return_number,
      created_at: r.created_at,
      subtotal: Number(r.subtotal),
      tax: Number(r.tax_amount),
      items: returnItems
        .filter((x) => x.return_id === r.id)
        .map((x) => ({ sale_item_id: x.sale_item_id, quantity: Number(x.quantity) })),
    })),
    fromIso,
    toExclusiveIso,
  })
}
