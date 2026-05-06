/**
 * Sale receipt PDF — bilingual EN+ES per CLAUDE.md Rule 6.
 *
 * Layout strategy mirrors PawnTicketPDF (stacked-pair labels, table for
 * line items, three-column totals breakdown). No legal-disclosure block
 * — retail receipts don't carry the same regulatory weight as pawn
 * tickets, but the per-tenant return policy is rendered as plain prose
 * via i18n (so future state-specific notice text is a translation patch).
 *
 * Single page in the common case (≤ ~12 line items + ≤ ~5 payments).
 * Spills naturally if the cart is unusually large.
 */

import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
} from '@react-pdf/renderer'
import { reportColors } from '@/lib/tokens'
import type { Dictionary } from '@/lib/i18n/en'

// ── Types ──────────────────────────────────────────────────────────────────

export type SaleReceiptItem = {
  description: string
  sku: string | null
  quantity: number
  unit_price: number
  line_discount: number
  line_total: number
}

export type SaleReceiptPayment = {
  amount: number
  method: 'cash' | 'card' | 'check' | 'other' | string
  occurred_at: string
}

export type SaleReceiptCustomer = {
  full_name: string | null
  phone: string | null
  email: string | null
}

export type SaleReceiptTenant = {
  name: string
  dba: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  phone: string | null
  email: string | null
}

export type SaleReceiptData = {
  sale_number: string
  status: string
  is_locked: boolean
  sale_kind: 'retail' | 'layaway' | string
  subtotal: number
  discount_amount: number
  tax_rate: number
  tax_amount: number
  total: number
  paid_total: number
  notes: string | null
  customer: SaleReceiptCustomer | null
  tenant: SaleReceiptTenant
  items: ReadonlyArray<SaleReceiptItem>
  payments: ReadonlyArray<SaleReceiptPayment>
  i18n: { en: Dictionary; es: Dictionary }
  /** ISO date the receipt is being rendered. */
  printed_on: string
}

// ── Styles ─────────────────────────────────────────────────────────────────

const PALETTE = {
  ink: reportColors.ink,
  body: reportColors.body,
  muted: reportColors.muted,
  divider: reportColors.divider,
  gold: '#ff385c',
  cloud: '#f7f7f7',
} as const

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 48,
    paddingHorizontal: 36,
    fontSize: 9,
    fontFamily: 'Inter',
    fontWeight: 500,
    color: PALETTE.body,
    lineHeight: 1.4,
  },

  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  headerTenantBlock: {
    flexDirection: 'column',
    maxWidth: '60%',
  },
  tenantName: {
    fontSize: 14,
    fontWeight: 700,
    color: PALETTE.ink,
    letterSpacing: -0.1,
  },
  tenantSubline: {
    fontSize: 8,
    color: PALETTE.muted,
    marginTop: 1,
  },
  ticketBadge: {
    flexDirection: 'column',
    alignItems: 'flex-end',
  },
  ticketKicker: {
    fontSize: 7,
    color: PALETTE.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  ticketNumber: {
    fontFamily: 'JetBrains Mono',
    fontSize: 18,
    fontWeight: 700,
    color: PALETTE.gold,
    marginTop: 2,
  },
  statusPill: {
    marginTop: 4,
    fontSize: 7,
    fontWeight: 700,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    color: PALETTE.body,
    backgroundColor: PALETTE.cloud,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },

  divider: {
    borderBottomWidth: 1,
    borderBottomColor: PALETTE.divider,
    borderBottomStyle: 'solid',
    marginVertical: 8,
  },

  sectionTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 6,
  },
  sectionTitle: {
    fontSize: 9,
    fontWeight: 700,
    color: PALETTE.ink,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  sectionTitleEs: {
    fontSize: 8,
    color: PALETTE.muted,
  },

  fieldGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -4,
  },
  fieldCell: {
    paddingHorizontal: 4,
    paddingVertical: 3,
    width: '50%',
  },
  fieldLabel: {
    fontSize: 7,
    color: PALETTE.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  fieldLabelEs: {
    fontSize: 7,
    color: PALETTE.muted,
  },
  fieldValue: {
    fontSize: 10,
    color: PALETTE.ink,
    marginTop: 1,
  },

  // ── Items table
  table: {
    borderTopWidth: 1,
    borderTopColor: PALETTE.divider,
    borderBottomWidth: 1,
    borderBottomColor: PALETTE.divider,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: PALETTE.cloud,
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  tableHeaderCell: {
    fontSize: 7,
    fontWeight: 700,
    color: PALETTE.ink,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  tableHeaderCellEs: {
    fontSize: 6,
    color: PALETTE.muted,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderTopWidth: 1,
    borderTopColor: PALETTE.divider,
    borderTopStyle: 'solid',
  },
  tableCell: {
    fontSize: 9,
    color: PALETTE.body,
  },
  tableCellMono: {
    fontFamily: 'JetBrains Mono',
    fontSize: 9,
    color: PALETTE.ink,
    textAlign: 'right',
  },
  colDesc: { width: '52%' },
  colSku: { width: '14%' },
  colQty: { width: '8%', textAlign: 'right' },
  colUnit: { width: '12%', textAlign: 'right' },
  colLine: { width: '14%', textAlign: 'right' },

  // ── Totals
  totalsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 8,
  },
  totalsBox: {
    width: '50%',
  },
  totalsLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  totalsLabel: {
    fontSize: 9,
    color: PALETTE.muted,
  },
  totalsValue: {
    fontFamily: 'JetBrains Mono',
    fontSize: 9,
    color: PALETTE.ink,
  },
  totalsGrand: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: PALETTE.ink,
    borderTopStyle: 'solid',
  },
  totalsGrandLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: PALETTE.ink,
  },
  totalsGrandValue: {
    fontFamily: 'JetBrains Mono',
    fontSize: 11,
    fontWeight: 700,
    color: PALETTE.ink,
  },

  // ── Payments
  paymentsList: {
    marginTop: 4,
  },
  paymentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  paymentMethod: {
    fontSize: 9,
    color: PALETTE.body,
  },
  paymentAmount: {
    fontFamily: 'JetBrains Mono',
    fontSize: 9,
    color: PALETTE.ink,
  },

  // ── Footer
  footer: {
    position: 'absolute',
    bottom: 18,
    left: 36,
    right: 36,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 7,
    color: PALETTE.muted,
  },
  footerMono: {
    fontFamily: 'JetBrains Mono',
    fontSize: 7,
    color: PALETTE.muted,
  },

  noteBox: {
    marginTop: 8,
    fontSize: 8,
    color: PALETTE.body,
    lineHeight: 1.35,
  },
  noteLabel: {
    fontSize: 7,
    color: PALETTE.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
})

// ── Helpers ────────────────────────────────────────────────────────────────

function formatMoney(n: number): string {
  if (!isFinite(n)) return '—'
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatPercent(decimalRate: number): string {
  if (!isFinite(decimalRate)) return '—'
  return `${(decimalRate * 100).toFixed(2)}%`
}

function formatQty(q: number): string {
  // Drop trailing zeros for whole quantities; keep up to 3 decimals for
  // weighted items.
  const rounded = Math.round(q * 1000) / 1000
  return Number.isInteger(rounded) ? `${rounded}` : `${rounded}`
}

function joinAddress(parts: ReadonlyArray<string | null | undefined>): string {
  return parts.filter((p): p is string => Boolean(p && p.trim())).join(', ') || '—'
}

function Field({
  labelEn,
  labelEs,
  value,
}: {
  labelEn: string
  labelEs: string
  value: React.ReactNode
}) {
  return (
    <View style={styles.fieldCell}>
      <Text style={styles.fieldLabel}>
        {labelEn}
        <Text style={styles.fieldLabelEs}> / {labelEs}</Text>
      </Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  )
}

// ── Component ──────────────────────────────────────────────────────────────

export default function SaleReceiptPDF({ data }: { data: SaleReceiptData }) {
  const en = data.i18n.en.pos.print
  const es = data.i18n.es.pos.print

  const tenantSubline = joinAddress([
    data.tenant.address,
    data.tenant.city,
    data.tenant.state,
    data.tenant.zip,
  ])
  const customerName =
    data.customer?.full_name?.trim() || en.customer.anonymous

  const balanceDue = Math.max(0, data.total - data.paid_total)

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {/* Header */}
        <View style={styles.headerRow}>
          <View style={styles.headerTenantBlock}>
            <Text style={styles.tenantName}>
              {data.tenant.dba?.trim() || data.tenant.name}
            </Text>
            <Text style={styles.tenantSubline}>{tenantSubline}</Text>
            {data.tenant.phone || data.tenant.email ? (
              <Text style={styles.tenantSubline}>
                {[data.tenant.phone, data.tenant.email]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            ) : null}
          </View>
          <View style={styles.ticketBadge}>
            <Text style={styles.ticketKicker}>
              {en.header}
              {' / '}
              <Text style={styles.fieldLabelEs}>{es.header}</Text>
            </Text>
            <Text style={styles.ticketNumber}>{data.sale_number || '—'}</Text>
            <Text style={styles.statusPill}>{data.status}</Text>
          </View>
        </View>

        <View style={styles.divider} />

        {/* Customer + sale meta */}
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitle}>
            {en.sections.sale}
            <Text style={styles.sectionTitleEs}> / {es.sections.sale}</Text>
          </Text>
          <Text style={styles.fieldLabel}>{data.printed_on}</Text>
        </View>
        <View style={styles.fieldGrid}>
          <Field
            labelEn={en.customer.name}
            labelEs={es.customer.name}
            value={customerName}
          />
          <Field
            labelEn={en.customer.phone}
            labelEs={es.customer.phone}
            value={data.customer?.phone ?? '—'}
          />
          <Field
            labelEn={en.meta.kind}
            labelEs={es.meta.kind}
            value={
              data.sale_kind === 'layaway'
                ? en.meta.kindLayaway
                : en.meta.kindRetail
            }
          />
          <Field
            labelEn={en.meta.taxRate}
            labelEs={es.meta.taxRate}
            value={formatPercent(data.tax_rate)}
          />
        </View>

        <View style={styles.divider} />

        {/* Items table */}
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitle}>
            {en.sections.items}
            <Text style={styles.sectionTitleEs}> / {es.sections.items}</Text>
          </Text>
        </View>
        {data.items.length === 0 ? (
          <Text style={styles.noteBox}>{en.itemsEmpty}</Text>
        ) : (
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeaderCell, styles.colDesc]}>
                {en.columns.description}
                <Text style={styles.tableHeaderCellEs}>
                  {' / '}
                  {es.columns.description}
                </Text>
              </Text>
              <Text style={[styles.tableHeaderCell, styles.colSku]}>
                {en.columns.sku}
              </Text>
              <Text style={[styles.tableHeaderCell, styles.colQty]}>
                {en.columns.qty}
              </Text>
              <Text style={[styles.tableHeaderCell, styles.colUnit]}>
                {en.columns.unit}
              </Text>
              <Text style={[styles.tableHeaderCell, styles.colLine]}>
                {en.columns.line}
              </Text>
            </View>
            {data.items.map((it, i) => (
              <View key={i} style={styles.tableRow}>
                <Text style={[styles.tableCell, styles.colDesc]}>
                  {it.description}
                </Text>
                <Text style={[styles.tableCellMono, styles.colSku]}>
                  {it.sku ?? '—'}
                </Text>
                <Text style={[styles.tableCellMono, styles.colQty]}>
                  {formatQty(it.quantity)}
                </Text>
                <Text style={[styles.tableCellMono, styles.colUnit]}>
                  {formatMoney(it.unit_price)}
                </Text>
                <Text style={[styles.tableCellMono, styles.colLine]}>
                  {formatMoney(it.line_total)}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Totals */}
        <View style={styles.totalsRow}>
          <View style={styles.totalsBox}>
            <View style={styles.totalsLine}>
              <Text style={styles.totalsLabel}>
                {en.totals.subtotal} / {es.totals.subtotal}
              </Text>
              <Text style={styles.totalsValue}>
                {formatMoney(data.subtotal)}
              </Text>
            </View>
            {data.discount_amount > 0 ? (
              <View style={styles.totalsLine}>
                <Text style={styles.totalsLabel}>
                  {en.totals.discount} / {es.totals.discount}
                </Text>
                <Text style={styles.totalsValue}>
                  −{formatMoney(data.discount_amount)}
                </Text>
              </View>
            ) : null}
            <View style={styles.totalsLine}>
              <Text style={styles.totalsLabel}>
                {en.totals.tax} / {es.totals.tax}
              </Text>
              <Text style={styles.totalsValue}>
                {formatMoney(data.tax_amount)}
              </Text>
            </View>
            <View style={styles.totalsGrand}>
              <Text style={styles.totalsGrandLabel}>
                {en.totals.total} / {es.totals.total}
              </Text>
              <Text style={styles.totalsGrandValue}>
                {formatMoney(data.total)}
              </Text>
            </View>
          </View>
        </View>

        {/* Payments */}
        <View style={styles.divider} />
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitle}>
            {en.sections.payments}
            <Text style={styles.sectionTitleEs}>
              {' / '}
              {es.sections.payments}
            </Text>
          </Text>
        </View>
        {data.payments.length === 0 ? (
          <Text style={styles.noteBox}>{en.paymentsEmpty}</Text>
        ) : (
          <View style={styles.paymentsList}>
            {data.payments.map((p, i) => (
              <View key={i} style={styles.paymentRow}>
                <Text style={styles.paymentMethod}>
                  {paymentMethodLabel(p.method, en, es)}
                  {p.occurred_at
                    ? ` · ${p.occurred_at.slice(0, 10)}`
                    : ''}
                </Text>
                <Text style={styles.paymentAmount}>
                  {formatMoney(p.amount)}
                </Text>
              </View>
            ))}
            <View style={styles.totalsGrand}>
              <Text style={styles.totalsGrandLabel}>
                {en.totals.paid} / {es.totals.paid}
              </Text>
              <Text style={styles.totalsGrandValue}>
                {formatMoney(data.paid_total)}
              </Text>
            </View>
            {balanceDue > 0.005 ? (
              <View style={styles.totalsLine}>
                <Text style={styles.totalsLabel}>
                  {en.totals.balance} / {es.totals.balance}
                </Text>
                <Text style={styles.totalsValue}>
                  {formatMoney(balanceDue)}
                </Text>
              </View>
            ) : null}
          </View>
        )}

        {/* Notes */}
        {data.notes ? (
          <View style={styles.divider} />
        ) : null}
        {data.notes ? (
          <View style={styles.noteBox}>
            <Text style={styles.noteLabel}>
              {en.notes} / {es.notes}
            </Text>
            <Text>{data.notes}</Text>
          </View>
        ) : null}

        {/* Return policy */}
        <View style={styles.divider} />
        <View style={styles.noteBox}>
          <Text style={styles.noteLabel}>
            {en.returnPolicy.title} / {es.returnPolicy.title}
          </Text>
          <Text>{en.returnPolicy.body}</Text>
          <Text style={{ marginTop: 4 }}>{es.returnPolicy.body}</Text>
        </View>

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text>
            {data.tenant.dba?.trim() || data.tenant.name} · {data.printed_on}
          </Text>
          <Text style={styles.footerMono}>{data.sale_number}</Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              en.footer.pageOf
                .replace('{n}', String(pageNumber))
                .replace('{total}', String(totalPages))
            }
          />
        </View>
      </Page>
    </Document>
  )
}

function paymentMethodLabel(
  method: string,
  en: Dictionary['pos']['print'],
  es: Dictionary['pos']['print'],
): string {
  const map: Record<string, { en: string; es: string }> = {
    cash: { en: en.payment.cash, es: es.payment.cash },
    card: { en: en.payment.card, es: es.payment.card },
    check: { en: en.payment.check, es: es.payment.check },
    other: { en: en.payment.other, es: es.payment.other },
  }
  const m = map[method]
  if (!m) return method
  return `${m.en} / ${m.es}`
}
