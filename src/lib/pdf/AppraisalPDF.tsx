/* eslint-disable jsx-a11y/alt-text */
/**
 * Appraisal certificate PDF — bilingual EN+ES per CLAUDE.md Rule 6.
 *
 * Layout strategy:
 *   - Stacked-pair labels for field rows ("Appraised value / Valor tasado").
 *   - Two-column legal block at the bottom for the longer disclosure copy.
 *   - Letter paper (8.5" × 11"). Density tuned so a typical certificate
 *     (≤ 4 photos in a 2×2 grid + one stones table) fits on one page;
 *     spills to additional pages on heavier content.
 *
 * Imagery:
 *   - Up to four item photos rendered in a 2×2 grid at 1:1. Caller passes
 *     pre-resolved data URLs (signed-URL fetch happens in render-appraisal).
 *   - Appraiser signature embedded if present; customer signature optional
 *     (shown only when provided — high-value appraisals usually capture it).
 *
 * TODO (Eddy, before going live):
 *   - The legal-disclaimer copy is a generic placeholder. Vet with counsel
 *     before printing customer-facing certificates. Updating is a translation
 *     patch (i18n keys appraisal.print.legal.*), not a component rewrite.
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
  AppraisalPurpose,
  AppraisalStatus,
  MetalType,
} from '@/types/database-aliases'

// ── Types ──────────────────────────────────────────────────────────────────

export type AppraisalCustomer = {
  full_name: string | null
  phone: string | null
  email: string | null
  address1: string | null
  address2: string | null
  city: string | null
  state: string | null
  zip: string | null
}

export type AppraisalTenant = {
  name: string
  dba: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  phone: string | null
  email: string | null
}

export type AppraisalStoneRowView = {
  position: number
  count: number
  type: string | null
  cut: string | null
  est_carat: number | null
  color: string | null
  clarity: string | null
  certified: boolean
  cert_lab: string | null
  cert_number: string | null
}

export type AppraisalPhotoView = {
  kind: 'front' | 'back' | 'detail' | 'serial' | 'cert' | 'reference'
  data_url: string | null
  caption: string | null
}

export type AppraisalAppraiser = {
  full_name: string | null
  email: string | null
  signature_image: string | null
}

export type AppraisalPdfData = {
  appraisal_number: string
  status: AppraisalStatus
  purpose: AppraisalPurpose
  is_printed: boolean
  item_description: string
  metal_type: MetalType | null
  karat: number | null
  weight_grams: number | null
  appraised_value: number
  replacement_value: number | null
  valuation_method: string | null
  notes: string | null
  valid_from: string
  valid_until: string | null
  customer: AppraisalCustomer | null
  tenant: AppraisalTenant
  appraiser: AppraisalAppraiser
  stones: ReadonlyArray<AppraisalStoneRowView>
  /** Up to 4 photos rendered in a 2×2 grid (others ignored on the print). */
  photos: ReadonlyArray<AppraisalPhotoView>
  /** Optional customer signature data URL. */
  customer_signature_image: string | null
  i18n: { en: Dictionary; es: Dictionary }
  /** Date this PDF is being rendered (printed-on stamp). ISO date. */
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

  // Header
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
  apraisalBadge: { flexDirection: 'column', alignItems: 'flex-end' },
  apraisalKicker: {
    fontSize: 7,
    color: PALETTE.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  apraisalNumber: {
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

  // Section
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
  sectionTitleEs: { fontSize: 8, color: PALETTE.muted, fontStyle: 'normal' },

  // Field rows
  fieldGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -4,
  },
  fieldCell: { paddingHorizontal: 4, paddingVertical: 3, width: '50%' },
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
  fieldLabelEs: { fontSize: 7, color: PALETTE.muted, fontStyle: 'normal' },
  fieldValue: { fontSize: 10, color: PALETTE.ink, marginTop: 1 },
  fieldValueMono: {
    fontFamily: 'JetBrains Mono',
    fontSize: 10,
    color: PALETTE.ink,
    marginTop: 1,
  },

  // Item description
  itemDesc: {
    fontSize: 10,
    color: PALETTE.ink,
    marginTop: 2,
    lineHeight: 1.45,
  },

  // Photos grid (2x2)
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -3,
    marginTop: 4,
  },
  photoCell: {
    width: '50%',
    paddingHorizontal: 3,
    paddingVertical: 3,
  },
  photoBox: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: PALETTE.cloud,
    borderRadius: 8,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoImage: { width: '100%', height: '100%', objectFit: 'cover' },
  photoCaption: { fontSize: 7, color: PALETTE.muted, marginTop: 2 },

  // Stones table
  table: {
    borderTopWidth: 1,
    borderTopColor: PALETTE.divider,
    borderBottomWidth: 1,
    borderBottomColor: PALETTE.divider,
    marginTop: 4,
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
  },
  colIdx: { width: '5%' },
  colCount: { width: '7%' },
  colType: { width: '16%' },
  colCut: { width: '12%' },
  colCarat: { width: '10%' },
  colColor: { width: '8%' },
  colClarity: { width: '10%' },
  colCert: { width: '32%' },

  // Valuation summary
  valuationBox: {
    flexDirection: 'row',
    marginTop: 6,
    columnGap: 12,
    alignItems: 'flex-start',
  },
  valuationCol: { flex: 1 },
  valuationKicker: {
    fontSize: 7,
    color: PALETTE.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  appraisedValueText: {
    fontFamily: 'JetBrains Mono',
    fontSize: 22,
    fontWeight: 700,
    color: PALETTE.ink,
    marginTop: 2,
  },
  replacementValueText: {
    fontFamily: 'JetBrains Mono',
    fontSize: 14,
    fontWeight: 700,
    color: PALETTE.body,
    marginTop: 2,
  },

  // Method paragraph
  methodPara: {
    fontSize: 9,
    color: PALETTE.body,
    marginTop: 4,
    lineHeight: 1.45,
  },

  // Legal block
  legalRow: { flexDirection: 'row', marginTop: 4, columnGap: 12 },
  legalCol: { flex: 1 },
  legalLang: {
    fontSize: 7,
    fontWeight: 700,
    color: PALETTE.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  legalText: { fontSize: 8, color: PALETTE.body, lineHeight: 1.35 },

  // Signatures
  signatureGrid: { flexDirection: 'row', columnGap: 16, marginTop: 12 },
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
  signatureImageBox: {
    height: 28,
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
  },
  signatureImage: { height: 28, objectFit: 'contain' },

  // Footer
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
  footerNumber: {
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

export default function AppraisalPDF({ data }: { data: AppraisalPdfData }) {
  const en = data.i18n.en.appraisal.print
  const es = data.i18n.es.appraisal.print

  const tenantSubline = joinAddress([
    data.tenant.address,
    data.tenant.city,
    data.tenant.state,
    data.tenant.zip,
  ])

  const customerAddress = data.customer
    ? joinAddress([
        data.customer.address1,
        data.customer.address2,
        data.customer.city,
        data.customer.state,
        data.customer.zip,
      ])
    : '—'

  const tenantContact = [
    data.tenant.phone ?? '',
    data.tenant.email ?? '',
  ]
    .filter(Boolean)
    .join('  ·  ')

  const purposeLabelEn = en.purposes[data.purpose]
  const purposeLabelEs = es.purposes[data.purpose]

  // Slice photos to 4 (2×2 grid).
  const gridPhotos = data.photos.slice(0, 4)

  return (
    <Document title={`Appraisal ${data.appraisal_number}`}>
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
          <View style={styles.apraisalBadge}>
            <Text style={styles.apraisalKicker}>
              {en.header} / {es.header}
            </Text>
            <Text style={styles.apraisalNumber}>{data.appraisal_number}</Text>
            {data.status !== 'finalized' ? (
              <Text style={styles.statusPill}>{data.status}</Text>
            ) : null}
          </View>
        </View>

        <View style={styles.divider} />

        {/* ── Validity + purpose */}
        <View style={styles.fieldGrid}>
          <Field
            labelEn={en.fields.purpose}
            labelEs={es.fields.purpose}
            value={`${purposeLabelEn} / ${purposeLabelEs}`}
            width="third"
          />
          <Field
            labelEn={en.fields.validFrom}
            labelEs={es.fields.validFrom}
            value={data.valid_from}
            mono
            width="third"
          />
          <Field
            labelEn={en.fields.validUntil}
            labelEs={es.fields.validUntil}
            value={dash(data.valid_until)}
            mono
            width="third"
          />
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
            value={dash(data.customer?.full_name ?? null)}
          />
          <Field
            labelEn={en.customer.phone}
            labelEs={es.customer.phone}
            value={dash(data.customer?.phone ?? null)}
          />
          <Field
            labelEn={en.customer.email}
            labelEs={es.customer.email}
            value={dash(data.customer?.email ?? null)}
          />
          <Field
            labelEn={en.customer.address}
            labelEs={es.customer.address}
            value={customerAddress}
          />
        </View>

        <View style={styles.divider} />

        {/* ── Item description + metal */}
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitle}>
            {en.sections.item}
            <Text style={styles.sectionTitleEs}> / {es.sections.item}</Text>
          </Text>
        </View>
        <Text style={styles.itemDesc}>{data.item_description}</Text>
        <View style={[styles.fieldGrid, { marginTop: 6 }]}>
          <Field
            labelEn={en.fields.metal}
            labelEs={es.fields.metal}
            value={dash(data.metal_type)}
            width="third"
          />
          <Field
            labelEn={en.fields.karat}
            labelEs={es.fields.karat}
            value={data.karat == null ? '—' : `${data.karat}k`}
            mono
            width="third"
          />
          <Field
            labelEn={en.fields.weightGrams}
            labelEs={es.fields.weightGrams}
            value={
              data.weight_grams == null
                ? '—'
                : `${data.weight_grams.toFixed(2)} g`
            }
            mono
            width="third"
          />
        </View>

        {/* ── Photos */}
        {gridPhotos.length > 0 ? (
          <>
            <View style={styles.divider} />
            <View style={styles.sectionTitleRow}>
              <Text style={styles.sectionTitle}>
                {en.sections.photos}
                <Text style={styles.sectionTitleEs}>
                  {' '}
                  / {es.sections.photos}
                </Text>
              </Text>
            </View>
            <View style={styles.photoGrid}>
              {gridPhotos.map((p, i) => (
                <View key={i} style={styles.photoCell} wrap={false}>
                  <View style={styles.photoBox}>
                    {p.data_url ? (
                      <Image src={p.data_url} style={styles.photoImage} />
                    ) : null}
                  </View>
                  {p.caption ? (
                    <Text style={styles.photoCaption}>{p.caption}</Text>
                  ) : (
                    <Text style={styles.photoCaption}>{p.kind}</Text>
                  )}
                </View>
              ))}
            </View>
          </>
        ) : null}

        {/* ── Stones */}
        {data.stones.length > 0 ? (
          <>
            <View style={styles.divider} />
            <View style={styles.sectionTitleRow}>
              <Text style={styles.sectionTitle}>
                {en.sections.stones}
                <Text style={styles.sectionTitleEs}>
                  {' '}
                  / {es.sections.stones}
                </Text>
              </Text>
            </View>
            <View style={styles.table}>
              <View style={styles.tableHeader}>
                <Text style={[styles.tableHeaderCell, styles.colIdx]}>#</Text>
                <Text style={[styles.tableHeaderCell, styles.colCount]}>
                  {en.stoneColumns.count}
                </Text>
                <Text style={[styles.tableHeaderCell, styles.colType]}>
                  {en.stoneColumns.type}
                  <Text style={styles.tableHeaderCellEs}>
                    {' / '}
                    {es.stoneColumns.type}
                  </Text>
                </Text>
                <Text style={[styles.tableHeaderCell, styles.colCut]}>
                  {en.stoneColumns.cut}
                </Text>
                <Text style={[styles.tableHeaderCell, styles.colCarat]}>
                  {en.stoneColumns.carat}
                </Text>
                <Text style={[styles.tableHeaderCell, styles.colColor]}>
                  {en.stoneColumns.color}
                </Text>
                <Text style={[styles.tableHeaderCell, styles.colClarity]}>
                  {en.stoneColumns.clarity}
                </Text>
                <Text style={[styles.tableHeaderCell, styles.colCert]}>
                  {en.stoneColumns.cert}
                  <Text style={styles.tableHeaderCellEs}>
                    {' / '}
                    {es.stoneColumns.cert}
                  </Text>
                </Text>
              </View>
              {data.stones.map((s, i) => (
                <View key={i} style={styles.tableRow} wrap={false}>
                  <Text style={[styles.tableCellMono, styles.colIdx]}>
                    {s.position}
                  </Text>
                  <Text style={[styles.tableCellMono, styles.colCount]}>
                    {s.count}
                  </Text>
                  <Text style={[styles.tableCell, styles.colType]}>
                    {s.type ?? '—'}
                  </Text>
                  <Text style={[styles.tableCell, styles.colCut]}>
                    {s.cut ?? '—'}
                  </Text>
                  <Text style={[styles.tableCellMono, styles.colCarat]}>
                    {s.est_carat == null ? '—' : s.est_carat.toFixed(2)}
                  </Text>
                  <Text style={[styles.tableCell, styles.colColor]}>
                    {s.color ?? '—'}
                  </Text>
                  <Text style={[styles.tableCell, styles.colClarity]}>
                    {s.clarity ?? '—'}
                  </Text>
                  <Text style={[styles.tableCell, styles.colCert]}>
                    {s.certified
                      ? `${s.cert_lab ?? ''} ${s.cert_number ?? ''}`.trim() ||
                        en.stoneColumns.certified
                      : '—'}
                  </Text>
                </View>
              ))}
            </View>
          </>
        ) : null}

        <View style={styles.divider} />

        {/* ── Valuation summary */}
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitle}>
            {en.sections.valuation}
            <Text style={styles.sectionTitleEs}>
              {' '}
              / {es.sections.valuation}
            </Text>
          </Text>
        </View>
        <View style={styles.valuationBox}>
          <View style={styles.valuationCol}>
            <Text style={styles.valuationKicker}>
              {en.fields.appraisedValue} / {es.fields.appraisedValue}
            </Text>
            <Text style={styles.appraisedValueText}>
              {formatMoney(data.appraised_value)}
            </Text>
          </View>
          {data.replacement_value != null ? (
            <View style={styles.valuationCol}>
              <Text style={styles.valuationKicker}>
                {en.fields.replacementValue} / {es.fields.replacementValue}
              </Text>
              <Text style={styles.replacementValueText}>
                {formatMoney(data.replacement_value)}
              </Text>
            </View>
          ) : null}
        </View>
        {data.valuation_method ? (
          <Text style={styles.methodPara}>
            <Text style={styles.fieldLabel}>
              {en.fields.method} / {es.fields.method}:{' '}
            </Text>
            {data.valuation_method}
          </Text>
        ) : null}
        {data.notes ? (
          <Text style={styles.methodPara}>
            <Text style={styles.fieldLabel}>
              {en.fields.notes} / {es.fields.notes}:{' '}
            </Text>
            {data.notes}
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
              {en.legal.disclaimer}
            </Text>
          </View>
          <View style={styles.legalCol}>
            <Text style={styles.legalLang}>ES</Text>
            <Text style={styles.legalText}>{es.legal.placeholder}</Text>
            <Text style={[styles.legalText, { marginTop: 4 }]}>
              {es.legal.disclaimer}
            </Text>
          </View>
        </View>

        {/* ── Signatures */}
        <View style={styles.signatureGrid}>
          <View style={styles.signatureCell}>
            <View style={styles.signatureImageBox}>
              {data.appraiser.signature_image ? (
                <Image
                  src={data.appraiser.signature_image}
                  style={styles.signatureImage}
                />
              ) : null}
            </View>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>
              {en.signatures.appraiser} / {es.signatures.appraiser}
              {data.appraiser.full_name ? `  ·  ${data.appraiser.full_name}` : ''}
            </Text>
          </View>
          <View style={styles.signatureCell}>
            <View style={styles.signatureImageBox}>
              {data.customer_signature_image ? (
                <Image
                  src={data.customer_signature_image}
                  style={styles.signatureImage}
                />
              ) : null}
            </View>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>
              {en.signatures.customer} / {es.signatures.customer}
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
          <Text style={styles.footerNumber}>
            {data.appraisal_number}  ·  {data.tenant.dba?.trim() || data.tenant.name}
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
