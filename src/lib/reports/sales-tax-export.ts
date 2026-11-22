/**
 * The sales tax report as flat rows for its two exports. Pure.
 *
 *   CSV  one row per sale / return / void AND tax line, so a spreadsheet can
 *        total by tax line, by reason or by day. `amount` is what that tax
 *        line was charged on; a return or void carries negative amounts.
 *   PDF  the summary a shop files from: one row per tax line, then one row
 *        per reason for the sales with no tax.
 *
 * Export labels are English, like every other report export.
 */

import type { SalesTaxReport } from './sales-tax'

const pct = (rate: number) => `${Math.round(rate * 10000) / 100}%`

/** "One rate, no split (7%)" — a sale that kept no split by tax line. */
const flatName = (rate: number) => `One rate, no split (${pct(rate)})`

const REASONS: Record<string, string> = {
  resale: 'Resale',
  organization: 'Exempt organization',
  government: 'Government',
  export: 'Shipped out of state',
  other: 'Other',
}
const reasonName = (reason: string | null) => (reason == null ? 'No reason recorded' : (REASONS[reason] ?? reason))

export type SalesTaxCsvRow = {
  type: 'sale' | 'return' | 'void'
  date: string
  number: string
  sale_number: string
  tenant_id: string
  customer_name: string | null
  /** The tax line's name; "exempt" / "no tax" for a sale that was charged none. */
  tax_line: string
  rate: number
  /** What this tax line was charged on (the whole sale for a no-tax row). */
  amount: number
  tax: number
  exempt_reason: string | null
  certificate: string | null
}

export function salesTaxCsvRows(report: SalesTaxReport): SalesTaxCsvRow[] {
  return report.documents.flatMap((d) => {
    const base = {
      type: d.kind,
      date: d.at,
      number: d.number,
      sale_number: d.sale_number,
      tenant_id: d.tenant_id,
      customer_name: d.customer_name,
      exempt_reason: d.exempt_reason,
      certificate: d.certificate,
    }
    if (d.parts.length === 0) {
      return [{ ...base, tax_line: d.exempt_reason != null ? 'exempt' : 'no tax', rate: 0, amount: d.before_tax, tax: d.tax }]
    }
    return d.parts.map((p) => ({
      ...base,
      tax_line: p.name || flatName(p.rate),
      rate: p.rate,
      amount: p.taxable,
      tax: p.tax,
    }))
  })
}

export type SalesTaxPdfRow = {
  section: 'TAX' | 'NO TAX'
  label: string
  rate: string
  /** Sales count for a no-tax row; blank for a tax line. */
  count: string
  amount: number
  tax: number | null
  tax_refunded: number | null
  net_tax: number | null
}

export function salesTaxPdfRows(report: SalesTaxReport): SalesTaxPdfRow[] {
  return [
    ...report.lines.map(
      (l): SalesTaxPdfRow => ({
        section: 'TAX',
        label: l.flat ? flatName(l.rate) : l.name,
        rate: pct(l.rate),
        count: '',
        amount: l.taxable,
        tax: l.tax,
        tax_refunded: l.tax_refunded,
        net_tax: l.net_tax,
      }),
    ),
    ...report.noTax.map(
      (g): SalesTaxPdfRow => ({
        section: 'NO TAX',
        label: reasonName(g.reason),
        rate: '',
        count: String(g.count),
        amount: g.amount,
        tax: null,
        tax_refunded: null,
        net_tax: null,
      }),
    ),
  ]
}
