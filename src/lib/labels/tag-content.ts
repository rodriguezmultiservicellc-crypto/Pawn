/**
 * What goes on a tag. Pure — both renderers (PDF, ZPL) print exactly this.
 *
 * Tag text is kept language-neutral (trade codes and numbers: "14K YG",
 * "4.2g", "$1,250") because a 2-inch tag has no room for two languages.
 * The two worded labels (due date, cost) carry both, short.
 *
 * Never on a tag: cost in clear, consignor, anything about a pledgor or a
 * repair customer. Collateral tags carry the ticket number only.
 */

import { encodeCost } from './cost-code'
import { collateralCode, SKU_NUMBER_DIGITS } from './scan'
import type { BarcodePayload, TagFields, TagKind } from './templates'

export type TagContent = {
  kind: TagKind
  /** Data the barcode encodes. */
  barcode: string
  /** Human-readable code printed under the bars. */
  code: string
  /** The big line: price on stock, null otherwise. */
  headline: string | null
  /** Small lines, in print order. Empty strings are dropped. */
  lines: string[]
}

const METAL_CODES: Record<string, string> = {
  gold: 'YG',
  white_gold: 'WG',
  rose_gold: 'RG',
  platinum: 'PT',
  palladium: 'PD',
  silver: 'AG',
  tungsten: 'TUNG',
  titanium: 'TI',
  stainless_steel: 'SS',
  mixed: 'MIX',
}

export function metalLine(metal: string | null | undefined, karat: string | number | null | undefined): string {
  const k = karat == null ? '' : String(karat).trim().toUpperCase()
  const karatText = k && /^\d+(\.\d+)?$/.test(k) && Number(k) <= 24 ? `${k}K` : k
  const code = metal ? (METAL_CODES[metal] ?? '') : ''
  return [karatText, code].filter(Boolean).join(' ')
}

export function weightLine(grams: number | string | null | undefined): string {
  const g = grams == null ? NaN : Number(grams)
  if (!Number.isFinite(g) || g <= 0) return ''
  return `${Number(g.toFixed(2))}g`
}

export function priceLine(price: number | string | null | undefined): string | null {
  const p = price == null ? NaN : Number(price)
  if (!Number.isFinite(p) || p <= 0) return null
  const whole = Math.round(p * 100) % 100 === 0
  return p.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })
}

export type StoneSummaryRow = {
  count: number | null
  carat: number | string | null
  is_total_carat: boolean | null
}

export function stonesLine(stones: readonly StoneSummaryRow[]): string {
  let count = 0
  let carats = 0
  for (const s of stones) {
    const n = Math.max(0, Number(s.count ?? 0)) || 0
    count += n
    const ct = Number(s.carat ?? 0)
    if (Number.isFinite(ct) && ct > 0) carats += s.is_total_carat ? ct : ct * Math.max(n, 1)
  }
  if (count === 0 && carats === 0) return ''
  const ct = carats > 0 ? `${Number(carats.toFixed(2))}ct` : ''
  return [count > 0 ? `${count}st` : '', ct].filter(Boolean).join(' ')
}

export function shortText(s: string | null | undefined, max = 48): string {
  const t = (s ?? '').replace(/\s+/g, ' ').trim()
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`
}

/** M/D/YY from a YYYY-MM-DD calendar date — no timezone conversion. */
export function tagDate(isoDate: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate ?? '')
  if (!m) return ''
  return `${Number(m[2])}/${Number(m[3])}/${m[1].slice(2)}`
}

function on(fields: TagFields, f: keyof TagFields): boolean {
  return fields[f] === true
}

// ── Inventory ─────────────────────────────────────────────────────────────

export type InventoryTagSource = {
  sku: string
  sku_number: number | null
  list_price: number | string | null
  metal: string | null
  karat: string | null
  weight_grams: number | string | null
  description: string
  cost_basis: number | string | null
  stones: readonly StoneSummaryRow[]
}

/**
 * The 'number' payload prints digits only, but only when the SKU is the
 * trigger-made INV-###### form. Imported items keep their own SKU text
 * (sku_number 0), so they always print the full SKU.
 */
export function inventoryBarcode(item: Pick<InventoryTagSource, 'sku' | 'sku_number'>, payload: BarcodePayload): string {
  const n = item.sku_number ?? 0
  const padded = String(n).padStart(SKU_NUMBER_DIGITS, '0')
  if (payload === 'number' && n > 0 && item.sku.toUpperCase() === `INV-${padded}`) return padded
  return item.sku
}

export function buildInventoryTag(args: {
  item: InventoryTagSource
  fields: TagFields
  payload: BarcodePayload
  costCodeWord: string | null
  shopName: string | null
}): TagContent {
  const { item, fields } = args
  const lines: string[] = []
  if (on(fields, 'metal') || on(fields, 'weight')) {
    lines.push(
      [on(fields, 'metal') ? metalLine(item.metal, item.karat) : '', on(fields, 'weight') ? weightLine(item.weight_grams) : '']
        .filter(Boolean)
        .join(' · '),
    )
  }
  if (on(fields, 'stones')) lines.push(stonesLine(item.stones))
  if (on(fields, 'description')) lines.push(shortText(item.description))
  if (on(fields, 'cost_code')) {
    const coded = encodeCost(Number(item.cost_basis ?? 0), args.costCodeWord)
    if (coded) lines.push(coded)
  }
  if (on(fields, 'shop_name') && args.shopName) lines.push(shortText(args.shopName, 32))
  return {
    kind: 'inventory',
    barcode: inventoryBarcode(item, args.payload),
    code: item.sku,
    headline: on(fields, 'price') ? priceLine(item.list_price) : null,
    lines: lines.filter(Boolean),
  }
}

// ── Pawn collateral ───────────────────────────────────────────────────────

export type CollateralTagSource = {
  ticket_number: string
  /** 0-based, as stored in loan_collateral_items.position. */
  position: number
  description: string
  metal_type: string | null
  karat: number | null
  weight_grams: number | string | null
  due_date: string | null
}

export function buildCollateralTag(args: { item: CollateralTagSource; fields: TagFields }): TagContent {
  const { item, fields } = args
  const code = collateralCode(item.ticket_number, item.position)
  const lines: string[] = []
  const mw = [on(fields, 'metal') ? metalLine(item.metal_type, item.karat) : '', on(fields, 'weight') ? weightLine(item.weight_grams) : '']
    .filter(Boolean)
    .join(' · ')
  lines.push(mw)
  if (on(fields, 'description')) lines.push(shortText(item.description))
  if (on(fields, 'due_date') && item.due_date) lines.push(`Due/Vence ${tagDate(item.due_date)}`)
  return { kind: 'collateral', barcode: code, code, headline: null, lines: lines.filter(Boolean) }
}

// ── Repair ────────────────────────────────────────────────────────────────

export type RepairTagSource = {
  ticket_number: string
  title: string
  promised_date: string | null
}

export function buildRepairTag(args: { item: RepairTagSource; fields: TagFields }): TagContent {
  const { item, fields } = args
  const lines: string[] = []
  if (on(fields, 'description')) lines.push(shortText(item.title))
  if (on(fields, 'due_date') && item.promised_date) lines.push(`Due/Listo ${tagDate(item.promised_date)}`)
  return {
    kind: 'repair',
    barcode: item.ticket_number,
    code: item.ticket_number,
    headline: null,
    lines: lines.filter(Boolean),
  }
}
