/* eslint-disable jsx-a11y/alt-text */
/**
 * Pawn ticket PDF — bilingual EN+ES per CLAUDE.md Rule 6.
 *
 * Layout strategy:
 *   - Stacked-pair labels for field rows ("Principal / Principal",
 *     "Interest rate / Tasa de interés"), so each field row stays compact.
 *   - Full bilingual paragraphs (two columns) for legal disclosure.
 *   - Letter paper (8.5" × 11"). Density tuned so one ticket fits on one
 *     page when collateral count is ≤ ~5 items; spills to additional pages
 *     beyond that.
 *
 * Imagery: collateral photos are NOT embedded. Paper isn't a great medium
 * for jewelry thumbs and the ticket is regulatory not marketing. Customer
 * signature IS embedded if present (passed in as a base64 data URL or
 * absolute http/https URL via PawnTicketData.signatureImage).
 *
 * TODO (Eddy, before going live in any state): the legal disclosure block
 * is a generic placeholder. Florida has specific pawn-loan disclosure
 * requirements (Ch. 539 F.S.) that must be vetted with counsel. The
 * placeholder is rendered via i18n keys (pawn.print.legal.*) so updating
 * it is a translation patch, not a component rewrite. Add a per-tenant
 * override field on `tenants` (or `settings`) when we land the second
 * jurisdiction.
 *
 * Type discipline: PawnTicketData is exported and the route handler /
 * render helper builds it from the user-scoped Supabase client. Every
 * field is required EXCEPT photos / signature paths (optional, may be
 * null).
 */

import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from '@react-pdf/renderer'
import { reportColors } from '@/lib/tokens'
import type { Dictionary } from '@/lib/i18n/en'
import type {
  InventoryCategory,
  LoanStatus,
  MetalType,
} from '@/types/database-aliases'

// ── Types ──────────────────────────────────────────────────────────────────

export type PawnTicketCollateral = {
  description: string
  category: InventoryCategory
  metal_type: MetalType | null
  karat: number | null
  weight_grams: number | null
  est_value: number
  has_photo: boolean
}

export type PawnTicketCustomer = {
  full_name: string
  date_of_birth: string | null
  address1: string | null
  address2: string | null
  city: string | null
  state: string | null
  zip: string | null
  phone: string | null
  email: string | null
  id_type: string | null
  id_number: string | null
  id_state: string | null
  id_expiry: string | null
}

export type PawnTicketTenant = {
  name: string
  dba: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  phone: string | null
  email: string | null
}

export type PawnTicketData = {
  ticket_number: string
  status: LoanStatus
  is_printed: boolean
  principal: number
  interest_rate_monthly: number
  /** Optional per-month interest floor. Null = no minimum. */
  min_monthly_charge: number | null
  term_days: number
  issue_date: string
  due_date: string
  /** Total interest at end-of-term (principal × monthlyRate × term/30). */
  total_interest_at_term: number
  /** Total payoff at end-of-term (principal + total_interest_at_term). */
  total_payoff_at_term: number
  /** Daily rate (monthly / 30) — informational only. */
  daily_rate: number
  notes: string | null
  customer: PawnTicketCustomer
  tenant: PawnTicketTenant
  collateral: ReadonlyArray<PawnTicketCollateral>
  /** Optional signature image. Either a data URL ('data:image/png;base64,…')
   *  or an absolute http/https URL (signed Storage URL). Null when missing. */
  signatureImage: string | null
  /** Pre-resolved bilingual dictionaries. We accept both because i18n is
   *  set up as a client-side React Context — server code hands the strings
   *  in directly. */
  i18n: { en: Dictionary; es: Dictionary }
  /** Date this PDF is being rendered (for the printed-on stamp). ISO date. */
  printed_on: string
}

// ── Styles ─────────────────────────────────────────────────────────────────

const PALETTE = {
  ink: reportColors.ink,
  body: reportColors.body,
  muted: reportColors.muted,
  divider: reportColors.divider,
  rausch: '#ff385c',
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

  // ── Header
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
    color: PALETTE.rausch,
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

  // ── Section
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
    fontStyle: 'normal',
  },

  // ── Field rows (stacked bilingual labels)
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
  fieldCellThird: {
    paddingHorizontal: 4,
    paddingVertical: 3,
    width: '33.3333%',
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
    fontStyle: 'normal',
  },
  fieldValue: {
    fontSize: 10,
    color: PALETTE.ink,
    marginTop: 1,
  },
  fieldValueMono: {
    fontFamily: 'JetBrains Mono',
    fontSize: 10,
    color: PALETTE.ink,
    marginTop: 1,
  },

  // ── Collateral table
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
  colIdx: { width: '4%' },
  colDesc: { width: '36%' },
  colCat: { width: '12%' },
  colMetal: { width: '12%' },
  colKarat: { width: '8%' },
  colWeight: { width: '12%' },
  colValue: { width: '16%' },

  photoNote: {
    marginTop: 4,
    fontSize: 7,
    color: PALETTE.muted,
    fontStyle: 'italic',
  },

  // ── Legal block
  legalRow: {
    flexDirection: 'row',
    marginTop: 4,
    columnGap: 12,
  },
  legalCol: {
    flex: 1,
  },
  legalLang: {
    fontSize: 7,
    fontWeight: 700,
    color: PALETTE.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  legalText: {
    fontSize: 8,
    color: PALETTE.body,
    lineHeight: 1.35,
  },

  // ── Signatures
  signatureGrid: {
    flexDirection: 'row',
    columnGap: 16,
    marginTop: 12,
  },
  signatureCell: {
    flex: 1,
  },
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
  signatureImageBox: {
    height: 28,
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
  },
  signatureImage: {
    height: 28,
    objectFit: 'contain',
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
  footerTicket: {
    fontFamily: 'JetBrains Mono',
    fontSize: 7,
    color: PALETTE.muted,
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

function joinAddress(parts: ReadonlyArray<string | null | undefined>): string {
  return parts.filter((p): p is string => Boolean(p && p.trim())).join(', ') || '—'
}

function dash(value: string | number | null | undefined): string {
  if (value == null) return '—'
  if (typeof value === 'string') return value.trim() || '—'
  return String(value)
}

// ── Field component ────────────────────────────────────────────────────────

function Field({
  labelEn,
  labelEs,
  value,
  mono,
  width,
}: {
  labelEn: string
  labelEs: string
  value: React.ReactNode
  mono?: boolean
  width?: 'half' | 'third'
}) {
  return (
    <View style={width === 'third' ? styles.fieldCellThird : styles.fieldCell}>
      <Text style={styles.fieldLabel}>
        {labelEn}
        <Text style={styles.fieldLabelEs}> / {labelEs}</Text>
      </Text>
      <Text style={mono ? styles.fieldValueMono : styles.fieldValue}>
        {value}
      </Text>
    </View>
  )
}

// ── Component ──────────────────────────────────────────────────────────────

export default function PawnTicketPDF({ data }: { data: PawnTicketData }) {
  const en = data.i18n.en.pawn.print
  const es = data.i18n.es.pawn.print

  const tenantSubline = joinAddress([
    data.tenant.address,
    data.tenant.city,
    data.tenant.state,
    data.tenant.zip,
  ])

  const customerAddress = joinAddress([
    data.customer.address1,
    data.customer.address2,
    data.customer.city,
    data.customer.state,
    data.customer.zip,
  ])

  const tenantPhone = data.tenant.phone ?? ''
  const tenantEmail = data.tenant.email ?? ''
  const tenantContact = [tenantPhone, tenantEmail].filter(Boolean).join('  ·  ')

  return (
    <Document title={`Pawn Ticket ${data.ticket_number}`}>
      <Page size="LETTER" style={styles.page} wrap>
        {/* ── Header */}
        <View style={styles.headerRow}>
          <View style={styles.headerTenantBlock}>
            <Text style={styles.tenantName}>
              {data.tenant.dba?.trim() || data.tenant.name}
            </Text>
            {data.tenant.dba?.trim() ? (
              <Text style={styles.tenantSubline}>{data.tenant.name}</Text>
            ) : null}
            <Text style={styles.tenantSubline}>{tenantSubline}</Text>
            {tenantContact ? (
              <Text style={styles.tenantSubline}>{tenantContact}</Text>
            ) : null}
          </View>
          <View style={styles.ticketBadge}>
            <Text style={styles.ticketKicker}>
              {en.header} / {es.header}
            </Text>
            <Text style={styles.ticketNumber}>{data.ticket_number}</Text>
            {data.status !== 'active' ? (
              <Text style={styles.statusPill}>{data.status}</Text>
            ) : null}
          </View>
        </View>

        <View style={styles.divider} />

        {/* ── Customer */}
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitle}>
            {en.sections.customer}
            <Text style={styles.sectionTitleEs}> / {es.sections.customer}</Text>
          </Text>
        </View>
        <View style={styles.fieldGrid}>
          <Field
            labelEn={en.customer.name}
            labelEs={es.customer.name}
            value={dash(data.customer.full_name)}
          />
          <Field
            labelEn={en.customer.dob}
            labelEs={es.customer.dob}
            value={dash(data.customer.date_of_birth)}
            mono
          />
          <Field
            labelEn={en.customer.address}
            labelEs={es.customer.address}
            value={customerAddress}
          />
          <Field
            labelEn={en.customer.phone}
            labelEs={es.customer.phone}
            value={dash(data.customer.phone)}
          />
          <Field
            labelEn={en.customer.email}
            labelEs={es.customer.email}
            value={dash(data.customer.email)}
          />
          <Field
            labelEn={en.customer.idType}
            labelEs={es.customer.idType}
            value={dash(data.customer.id_type)}
          />
          <Field
            labelEn={en.customer.idNumber}
            labelEs={es.customer.idNumber}
            value={dash(data.customer.id_number)}
            mono
          />
          <Field
            labelEn={en.customer.idState}
            labelEs={es.customer.idState}
            value={dash(data.customer.id_state)}
          />
          <Field
            labelEn={en.customer.idExpiry}
            labelEs={es.customer.idExpiry}
            value={dash(data.customer.id_expiry)}
            mono
          />
        </View>

        <View style={styles.divider} />

        {/* ── Loan terms */}
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitle}>
            {en.sections.terms}
            <Text style={styles.sectionTitleEs}> / {es.sections.terms}</Text>
          </Text>
        </View>
        <View style={styles.fieldGrid}>
          <Field
            labelEn={en.terms.principal}
            labelEs={es.terms.principal}
            value={formatMoney(data.principal)}
            mono
            width="third"
          />
          <Field
            labelEn={en.terms.interestRateMonthly}
            labelEs={es.terms.interestRateMonthly}
            value={formatPercent(data.interest_rate_monthly)}
            mono
            width="third"
          />
          {data.min_monthly_charge != null ? (
            <Field
              labelEn={en.terms.minMonthlyCharge ?? 'Min interest / mo'}
              labelEs={es.terms.minMonthlyCharge ?? 'Interés mín. / mes'}
              value={formatMoney(data.min_monthly_charge)}
              mono
              width="third"
            />
          ) : (
            <Field
              labelEn={en.terms.dailyRateNote}
              labelEs={es.terms.dailyRateNote}
              value={formatPercent(data.daily_rate)}
              mono
              width="third"
            />
          )}
          <Field
            labelEn={en.terms.termDays}
            labelEs={es.terms.termDays}
            value={`${data.term_days} d`}
            mono
            width="third"
          />
          <Field
            labelEn={en.terms.issueDate}
            labelEs={es.terms.issueDate}
            value={data.issue_date}
            mono
            width="third"
          />
          <Field
            labelEn={en.terms.dueDate}
            labelEs={es.terms.dueDate}
            value={data.due_date}
            mono
            width="third"
          />
          <Field
            labelEn={en.terms.totalInterestAtTerm}
            labelEs={es.terms.totalInterestAtTerm}
            value={formatMoney(data.total_interest_at_term)}
            mono
          />
          <Field
            labelEn={en.terms.totalPayoffAtTerm}
            labelEs={es.terms.totalPayoffAtTerm}
            value={formatMoney(data.total_payoff_at_term)}
            mono
          />
        </View>

        <View style={styles.divider} />

        {/* ── Collateral */}
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitle}>
            {en.collateral.title}
            <Text style={styles.sectionTitleEs}>
              {' '}
              / {es.collateral.title}
            </Text>
          </Text>
        </View>
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderCell, styles.colIdx]}>
              {en.collateral.columns.index}
            </Text>
            <Text style={[styles.tableHeaderCell, styles.colDesc]}>
              {en.collateral.columns.description}
              <Text style={styles.tableHeaderCellEs}>
                {' / '}
                {es.collateral.columns.description}
              </Text>
            </Text>
            <Text style={[styles.tableHeaderCell, styles.colCat]}>
              {en.collateral.columns.category}
              <Text style={styles.tableHeaderCellEs}>
                {' / '}
                {es.collateral.columns.category}
              </Text>
            </Text>
            <Text style={[styles.tableHeaderCell, styles.colMetal]}>
              {en.collateral.columns.metal}
              <Text style={styles.tableHeaderCellEs}>
                {' / '}
                {es.collateral.columns.metal}
              </Text>
            </Text>
            <Text style={[styles.tableHeaderCell, styles.colKarat]}>
              {en.collateral.columns.karat}
            </Text>
            <Text style={[styles.tableHeaderCell, styles.colWeight]}>
              {en.collateral.columns.weightGrams}
            </Text>
            <Text
              style={[
                styles.tableHeaderCell,
                styles.colValue,
                { textAlign: 'right' },
              ]}
            >
              {en.collateral.columns.estValue}
              <Text style={styles.tableHeaderCellEs}>
                {' / '}
                {es.collateral.columns.estValue}
              </Text>
            </Text>
          </View>
          {data.collateral.length === 0 ? (
            <View style={styles.tableRow}>
              <Text style={[styles.tableCell, { width: '100%' }]}>—</Text>
            </View>
          ) : (
            data.collateral.map((c, i) => (
              <View key={i} style={styles.tableRow} wrap={false}>
                <Text style={[styles.tableCellMono, styles.colIdx]}>
                  {i + 1}
                </Text>
                <Text style={[styles.tableCell, styles.colDesc]}>
                  {c.description}
                </Text>
                <Text style={[styles.tableCell, styles.colCat]}>
                  {c.category}
                </Text>
                <Text style={[styles.tableCell, styles.colMetal]}>
                  {c.metal_type ?? '—'}
                </Text>
                <Text style={[styles.tableCellMono, styles.colKarat]}>
                  {c.karat == null ? '—' : `${c.karat}k`}
                </Text>
                <Text style={[styles.tableCellMono, styles.colWeight]}>
                  {c.weight_grams == null ? '—' : `${c.weight_grams.toFixed(2)} g`}
                </Text>
                <Text style={[styles.tableCellMono, styles.colValue]}>
                  {formatMoney(c.est_value)}
                </Text>
              </View>
            ))
          )}
        </View>
        {data.collateral.some((c) => c.has_photo) ? (
          <Text style={styles.photoNote}>
            {en.collateral.photosOnFile} / {es.collateral.photosOnFile}
          </Text>
        ) : null}

        <View style={styles.divider} />

        {/* ── Legal disclosure */}
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitle}>
            {en.sections.legal}
            <Text style={styles.sectionTitleEs}> / {es.sections.legal}</Text>
          </Text>
        </View>
        <View style={styles.legalRow}>
          <View style={styles.legalCol}>
            <Text style={styles.legalLang}>EN</Text>
            <Text style={styles.legalText}>{en.legal.placeholder}</Text>
            <Text style={[styles.legalText, { marginTop: 4 }]}>
              {en.legal.terms}
            </Text>
          </View>
          <View style={styles.legalCol}>
            <Text style={styles.legalLang}>ES</Text>
            <Text style={styles.legalText}>{es.legal.placeholder}</Text>
            <Text style={[styles.legalText, { marginTop: 4 }]}>
              {es.legal.terms}
            </Text>
          </View>
        </View>

        {data.notes ? (
          <>
            <View style={styles.divider} />
            <Text style={styles.fieldLabel}>
              {en.notes} / {es.notes}
            </Text>
            <Text style={[styles.fieldValue, { marginTop: 2 }]}>
              {data.notes}
            </Text>
          </>
        ) : null}

        {/* ── Signatures */}
        <View style={styles.signatureGrid}>
          <View style={styles.signatureCell}>
            <View style={styles.signatureImageBox}>
              {data.signatureImage ? (
                <Image src={data.signatureImage} style={styles.signatureImage} />
              ) : null}
            </View>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>
              {en.signatures.customerSignature} /{' '}
              {es.signatures.customerSignature}
            </Text>
          </View>
          <View style={styles.signatureCell}>
            <View style={styles.signatureImageBox} />
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>
              {en.signatures.staffSignature} / {es.signatures.staffSignature}
            </Text>
          </View>
          <View style={styles.signatureCell}>
            <View style={styles.signatureImageBox} />
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>
              {en.signatures.date} / {es.signatures.date}
              {'  '}
              <Text style={{ fontFamily: 'JetBrains Mono' }}>
                {data.printed_on}
              </Text>
            </Text>
          </View>
        </View>

        {/* ── Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerTicket}>
            {data.ticket_number}  ·  {data.tenant.dba?.trim() || data.tenant.name}
          </Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              `${en.footer.pageOf
                .replace('{n}', String(pageNumber))
                .replace('{total}', String(totalPages))} / ${es.footer.pageOf
                .replace('{n}', String(pageNumber))
                .replace('{total}', String(totalPages))}`
            }
          />
        </View>
      </Page>
    </Document>
  )
}
