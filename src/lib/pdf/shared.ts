/**
 * Shared bits for the bilingual customer-facing PDFs (repair ticket, custom
 * quote). The receipt/ticket PDFs that predate this file carry their own
 * copies; new documents start here.
 *
 * GOTCHA — JetBrains Mono + "//": the mono face ships programming
 * ligatures ("//", "://", "->"). fontkit's GSUB pass over the WOFF throws
 * "RangeError: Offset is outside the bounds of the DataView" the moment a
 * ligature sequence appears in a mono run, which 500s the whole render.
 * Numbers, amounts and ticket numbers never contain one; URLs always do.
 * Render URLs (and any free text) in Inter, keep mono for numerals only.
 */

import { StyleSheet } from '@react-pdf/renderer'
import { reportColors } from '@/lib/tokens'

export const PDF_PALETTE = {
  ink: reportColors.ink,
  body: reportColors.body,
  muted: reportColors.muted,
  divider: reportColors.divider,
  cloud: '#f7f7f7',
} as const

export const pdfStyles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 48,
    paddingHorizontal: 36,
    fontSize: 9,
    fontFamily: 'Inter',
    fontWeight: 500,
    color: PDF_PALETTE.body,
    lineHeight: 1.4,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  headerTenantBlock: { flexDirection: 'column', maxWidth: '60%' },
  tenantName: { fontSize: 14, fontWeight: 700, color: PDF_PALETTE.ink, letterSpacing: -0.1 },
  tenantSubline: { fontSize: 8, color: PDF_PALETTE.muted, marginTop: 1 },
  badge: { flexDirection: 'column', alignItems: 'flex-end' },
  kicker: { fontSize: 7, color: PDF_PALETTE.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  kickerEs: { fontSize: 7, color: PDF_PALETTE.muted },
  docNumber: { fontFamily: 'JetBrains Mono', fontSize: 14, fontWeight: 700, color: PDF_PALETTE.ink, marginTop: 2 },
  small: { fontSize: 7, color: PDF_PALETTE.muted, marginTop: 2 },
  divider: { borderBottomWidth: 1, borderBottomColor: PDF_PALETTE.divider, borderBottomStyle: 'solid', marginVertical: 8 },
  sectionTitle: { fontSize: 9, fontWeight: 700, color: PDF_PALETTE.ink, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 },
  sectionTitleEs: { fontSize: 8, color: PDF_PALETTE.muted },
  fieldGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
  fieldCell: { paddingHorizontal: 4, paddingVertical: 3, width: '50%' },
  fieldCellThird: { paddingHorizontal: 4, paddingVertical: 3, width: '33.33%' },
  fieldLabel: { fontSize: 7, color: PDF_PALETTE.muted, textTransform: 'uppercase', letterSpacing: 0.4 },
  fieldLabelEs: { fontSize: 7, color: PDF_PALETTE.muted },
  fieldValue: { fontSize: 10, color: PDF_PALETTE.ink, marginTop: 1 },
  fieldValueMono: { fontFamily: 'JetBrains Mono', fontSize: 10, color: PDF_PALETTE.ink, marginTop: 1 },
  table: { borderTopWidth: 1, borderTopColor: PDF_PALETTE.divider, borderBottomWidth: 1, borderBottomColor: PDF_PALETTE.divider },
  tableHeader: { flexDirection: 'row', backgroundColor: PDF_PALETTE.cloud, paddingVertical: 4, paddingHorizontal: 4 },
  tableHeaderCell: { fontSize: 7, fontWeight: 700, color: PDF_PALETTE.ink, textTransform: 'uppercase', letterSpacing: 0.4 },
  tableHeaderCellEs: { fontSize: 6, color: PDF_PALETTE.muted },
  tableRow: { flexDirection: 'row', paddingVertical: 4, paddingHorizontal: 4, borderTopWidth: 1, borderTopColor: PDF_PALETTE.divider, borderTopStyle: 'solid' },
  tableCell: { fontSize: 9, color: PDF_PALETTE.body },
  tableCellMono: { fontFamily: 'JetBrains Mono', fontSize: 9, color: PDF_PALETTE.ink, textAlign: 'right' },
  totalsRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 },
  totalsBox: { width: '50%' },
  totalsLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  totalsLabel: { fontSize: 9, color: PDF_PALETTE.body },
  totalsValue: { fontFamily: 'JetBrains Mono', fontSize: 9, color: PDF_PALETTE.ink },
  totalsGrand: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 4, marginTop: 2, borderTopWidth: 1, borderTopColor: PDF_PALETTE.ink, borderTopStyle: 'solid' },
  totalsGrandLabel: { fontSize: 10, fontWeight: 700, color: PDF_PALETTE.ink },
  totalsGrandValue: { fontFamily: 'JetBrains Mono', fontSize: 11, fontWeight: 700, color: PDF_PALETTE.ink },
  noticeBox: { marginTop: 10, padding: 6, borderWidth: 1, borderColor: PDF_PALETTE.divider, borderStyle: 'solid', backgroundColor: PDF_PALETTE.cloud },
  noticeTitle: { fontSize: 7, fontWeight: 700, color: PDF_PALETTE.ink, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 },
  noticeText: { fontSize: 8, color: PDF_PALETTE.body, lineHeight: 1.35 },
  noticeTextEs: { fontSize: 8, color: PDF_PALETTE.muted, lineHeight: 1.35, marginTop: 2 },
  signatureGrid: { flexDirection: 'row', columnGap: 16, marginTop: 12 },
  signatureCell: { flex: 1 },
  signatureLine: { borderTopWidth: 1, borderTopColor: PDF_PALETTE.ink, borderTopStyle: 'solid', marginTop: 26 },
  signatureLabel: { fontSize: 7, color: PDF_PALETTE.muted, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.4 },
  footer: { position: 'absolute', bottom: 18, left: 36, right: 36, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7, color: PDF_PALETTE.muted },
  footerMono: { fontFamily: 'JetBrains Mono', fontSize: 7, color: PDF_PALETTE.muted },
})

export function pdfMoney(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '—'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function pdfJoin(parts: ReadonlyArray<string | null | undefined>): string {
  return parts.filter((p): p is string => Boolean(p && p.trim())).join(', ') || '—'
}

export type PdfTenant = {
  name: string
  dba: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  phone: string | null
  email: string | null
}
