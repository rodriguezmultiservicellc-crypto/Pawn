/**
 * Buy-outright receipt PDF — bilingual EN+ES per CLAUDE.md Rule 6.
 *
 * Buy-outright transactions are regulated: customer ID is required at
 * intake, items go on a hold for the state-mandated period (FL = 30 days
 * for jewelry by default), and the receipt itself is the customer's
 * proof-of-sale that they handed the goods over for a flat payout.
 *
 * Layout: tenant header → customer block (name + ID + address) →
 * items table (qty / metal+karat / weight / melt / payout) → total
 * payout → hold-period notice → signature line → footer.
 *
 * No "balance due" — buy-outright is paid in full at intake by
 * definition. Payment-method line could be added later when we capture
 * it; for now the action layer doesn't store a discrete payment row
 * because the cash flows out, not in.
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

export type BuyReceiptPDFItem = {
  description: string
  sku: string | null
  category: string | null
  metal: string | null
  karat: string | null
  weight_grams: number | null
  serial_number: string | null
  melt_value_at_buy: number | null
  payout: number
}

export type BuyReceiptPDFCustomer = {
  full_name: string
  id_type: string | null
  id_number: string | null
  phone: string | null
  email: string | null
  address: string
  date_of_birth: string | null
}

export type BuyReceiptPDFTenant = {
  name: string
  dba: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  phone: string | null
  email: string | null
}

export type BuyReceiptPDFData = {
  /** compliance_log.id — surfaces as the receipt's tracking number. */
  transaction_id: string
  occurred_at: string | null
  total_payout: number
  hold_period_days: number | null
  /** Earliest date the items become resaleable. ISO date. */
  hold_until: string | null
  customer: BuyReceiptPDFCustomer
  tenant: BuyReceiptPDFTenant
  items: ReadonlyArray<BuyReceiptPDFItem>
  i18n: { en: Dictionary; es: Dictionary }
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
  headerTenantBlock: { flexDirection: 'column', maxWidth: '60%' },
  tenantName: {
    fontSize: 14,
    fontWeight: 700,
    color: PALETTE.ink,
    letterSpacing: -0.1,
  },
  tenantSubline: { fontSize: 8, color: PALETTE.muted, marginTop: 1 },
  ticketBadge: { flexDirection: 'column', alignItems: 'flex-end' },
  ticketKicker: {
    fontSize: 7,
    color: PALETTE.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  ticketNumber: {
    fontFamily: 'JetBrains Mono',
    fontSize: 14,
    fontWeight: 700,
    color: PALETTE.gold,
    marginTop: 2,
  },
  printedOn: {
    fontSize: 7,
    color: PALETTE.muted,
    marginTop: 2,
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
  sectionTitleEs: { fontSize: 8, color: PALETTE.muted },

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
  fieldLabelEs: { fontSize: 7, color: PALETTE.muted },
  fieldValue: { fontSize: 10, color: PALETTE.ink, marginTop: 1 },

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
  tableHeaderCellEs: { fontSize: 6, color: PALETTE.muted },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderTopWidth: 1,
    borderTopColor: PALETTE.divider,
    borderTopStyle: 'solid',
  },
  tableCell: { fontSize: 9, color: PALETTE.body },
  tableCellMono: {
    fontFamily: 'JetBrains Mono',
    fontSize: 9,
    color: PALETTE.ink,
    textAlign: 'right',
  },
  colDesc: { width: '40%' },
  colMetal: { width: '14%' },
  colWeight: { width: '12%', textAlign: 'right' },
  colMelt: { width: '15%', textAlign: 'right' },
  colPayout: { width: '19%', textAlign: 'right' },

  totalsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 8,
  },
  totalsBox: { width: '50%' },
  totalsGrand: {
    flexDirection: 'row',
    justifyContent: 'space-between',
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

  noticeBox: {
    marginTop: 10,
    padding: 6,
    borderWidth: 1,
    borderColor: PALETTE.divider,
    borderStyle: 'solid',
    backgroundColor: PALETTE.cloud,
  },
  noticeTitle: {
    fontSize: 7,
    fontWeight: 700,
    color: PALETTE.ink,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  noticeText: { fontSize: 8, color: PALETTE.body, lineHeight: 1.35 },

  signatureGrid: {
    flexDirection: 'row',
    columnGap: 16,
    marginTop: 12,
  },
  signatureCell: { flex: 1 },
  signatureLine: {
    borderTopWidth: 1,
    borderTopColor: PALETTE.ink,
    borderTopStyle: 'solid',
    marginTop: 26,
  },
  signatureLabel: {
    fontSize: 7,
    color: PALETTE.muted,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },

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
})

// ── Helpers ────────────────────────────────────────────────────────────────

function formatMoney(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '—'
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatGrams(n: number | null): string {
  if (n == null || !isFinite(n)) return '—'
  return `${(Math.round(n * 1000) / 1000).toString()} g`
}

function joinAddress(parts: ReadonlyArray<string | null | undefined>): string {
  return parts.filter((p): p is string => Boolean(p && p.trim())).join(', ') || '—'
}

function metalKaratLabel(metal: string | null, karat: string | null): string {
  const parts: string[] = []
  if (metal && metal.trim()) parts.push(metal)
  if (karat && karat.trim()) parts.push(`${karat}k`)
  return parts.length ? parts.join(' ') : '—'
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

export default function BuyReceiptPDF({
  data,
}: {
  data: BuyReceiptPDFData
}) {
  const en = data.i18n.en.buy.print
  const es = data.i18n.es.buy.print

  const tenantSubline = joinAddress([
    data.tenant.address,
    data.tenant.city,
    data.tenant.state,
    data.tenant.zip,
  ])
  // Receipt number — short, mono. Use the last 8 chars of the
  // compliance_log UUID. Customer doesn't need the full UUID, but it's
  // unique enough to look up against the audit trail.
  const receiptNumber = `BO-${data.transaction_id.slice(-8).toUpperCase()}`

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
            <Text style={styles.ticketNumber}>{receiptNumber}</Text>
            <Text style={styles.printedOn}>
              {data.occurred_at?.slice(0, 10) ?? data.printed_on}
            </Text>
          </View>
        </View>

        <View style={styles.divider} />

        {/* Customer */}
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitle}>
            {en.sections.customer}
            <Text style={styles.sectionTitleEs}>
              {' / '}
              {es.sections.customer}
            </Text>
          </Text>
        </View>
        <View style={styles.fieldGrid}>
          <Field
            labelEn={en.customer.name}
            labelEs={es.customer.name}
            value={data.customer.full_name}
          />
          <Field
            labelEn={en.customer.dob}
            labelEs={es.customer.dob}
            value={data.customer.date_of_birth ?? '—'}
          />
          <Field
            labelEn={en.customer.address}
            labelEs={es.customer.address}
            value={data.customer.address}
          />
          <Field
            labelEn={en.customer.phone}
            labelEs={es.customer.phone}
            value={data.customer.phone ?? '—'}
          />
          <Field
            labelEn={en.customer.idType}
            labelEs={es.customer.idType}
            value={data.customer.id_type ?? '—'}
          />
          <Field
            labelEn={en.customer.idNumber}
            labelEs={es.customer.idNumber}
            value={data.customer.id_number ?? '—'}
          />
        </View>

        <View style={styles.divider} />

        {/* Items */}
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitle}>
            {en.sections.items}
            <Text style={styles.sectionTitleEs}>
              {' / '}
              {es.sections.items}
            </Text>
          </Text>
        </View>
        {data.items.length === 0 ? (
          <Text style={styles.noticeText}>{en.itemsEmpty}</Text>
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
              <Text style={[styles.tableHeaderCell, styles.colMetal]}>
                {en.columns.metal}
              </Text>
              <Text style={[styles.tableHeaderCell, styles.colWeight]}>
                {en.columns.weight}
              </Text>
              <Text style={[styles.tableHeaderCell, styles.colMelt]}>
                {en.columns.melt}
              </Text>
              <Text style={[styles.tableHeaderCell, styles.colPayout]}>
                {en.columns.payout}
              </Text>
            </View>
            {data.items.map((it, i) => (
              <View key={i} style={styles.tableRow}>
                <Text style={[styles.tableCell, styles.colDesc]}>
                  {it.description}
                  {it.serial_number ? `  ·  S/N ${it.serial_number}` : ''}
                </Text>
                <Text style={[styles.tableCell, styles.colMetal]}>
                  {metalKaratLabel(it.metal, it.karat)}
                </Text>
                <Text style={[styles.tableCellMono, styles.colWeight]}>
                  {formatGrams(it.weight_grams)}
                </Text>
                <Text style={[styles.tableCellMono, styles.colMelt]}>
                  {formatMoney(it.melt_value_at_buy)}
                </Text>
                <Text style={[styles.tableCellMono, styles.colPayout]}>
                  {formatMoney(it.payout)}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Total payout */}
        <View style={styles.totalsRow}>
          <View style={styles.totalsBox}>
            <View style={styles.totalsGrand}>
              <Text style={styles.totalsGrandLabel}>
                {en.totals.totalPayout} / {es.totals.totalPayout}
              </Text>
              <Text style={styles.totalsGrandValue}>
                {formatMoney(data.total_payout)}
              </Text>
            </View>
          </View>
        </View>

        {/* Hold-period notice */}
        <View style={styles.noticeBox}>
          <Text style={styles.noticeTitle}>
            {en.holdNotice.title} / {es.holdNotice.title}
          </Text>
          <Text style={styles.noticeText}>
            {data.hold_period_days
              ? en.holdNotice.bodyWithDays.replace(
                  '{days}',
                  String(data.hold_period_days),
                )
              : en.holdNotice.bodyGeneric}
            {data.hold_until ? `  (${data.hold_until})` : ''}
          </Text>
          <Text style={[styles.noticeText, { marginTop: 2 }]}>
            {data.hold_period_days
              ? es.holdNotice.bodyWithDays.replace(
                  '{days}',
                  String(data.hold_period_days),
                )
              : es.holdNotice.bodyGeneric}
            {data.hold_until ? `  (${data.hold_until})` : ''}
          </Text>
        </View>

        {/* Acknowledgement + signatures */}
        <View style={styles.noticeBox}>
          <Text style={styles.noticeTitle}>
            {en.acknowledgement.title} / {es.acknowledgement.title}
          </Text>
          <Text style={styles.noticeText}>{en.acknowledgement.body}</Text>
          <Text style={[styles.noticeText, { marginTop: 2 }]}>
            {es.acknowledgement.body}
          </Text>
        </View>

        <View style={styles.signatureGrid}>
          <View style={styles.signatureCell}>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>
              {en.signatures.customer} / {es.signatures.customer}
            </Text>
          </View>
          <View style={styles.signatureCell}>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>
              {en.signatures.staff} / {es.signatures.staff}
            </Text>
          </View>
          <View style={styles.signatureCell}>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>
              {en.signatures.date} / {es.signatures.date}
            </Text>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text>
            {data.tenant.dba?.trim() || data.tenant.name} · {data.printed_on}
          </Text>
          <Text style={styles.footerMono}>{receiptNumber}</Text>
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
