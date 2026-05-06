/**
 * Generic report PDF — a single component that renders any tabular report
 * with a title, date range, optional totals strip, and a row table.
 *
 * Each per-report PDF helper builds a column descriptor and totals tile,
 * passes it in here, and wraps via render-report.tsx (the buffer renderer).
 */

import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
} from '@react-pdf/renderer'
import { reportColors } from '@/lib/tokens'

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
  brand: {
    fontSize: 8,
    color: PALETTE.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  title: {
    fontSize: 18,
    fontWeight: 700,
    color: PALETTE.ink,
    letterSpacing: -0.2,
    marginTop: 1,
  },
  subline: {
    fontSize: 9,
    color: PALETTE.muted,
    marginTop: 1,
  },
  rangeBadge: {
    flexDirection: 'column',
    alignItems: 'flex-end',
  },
  rangeKicker: {
    fontSize: 7,
    color: PALETTE.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  rangeText: {
    fontFamily: 'JetBrains Mono',
    fontSize: 11,
    fontWeight: 700,
    color: PALETTE.gold,
    marginTop: 2,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: PALETTE.divider,
    borderBottomStyle: 'solid',
    marginVertical: 8,
  },
  totalsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -4,
    marginBottom: 6,
  },
  totalCell: {
    paddingHorizontal: 4,
    paddingVertical: 4,
    width: '25%',
  },
  totalLabel: {
    fontSize: 7,
    color: PALETTE.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  totalValue: {
    fontSize: 11,
    fontWeight: 700,
    color: PALETTE.ink,
    fontFamily: 'JetBrains Mono',
    marginTop: 1,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: PALETTE.cloud,
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  th: {
    fontSize: 7,
    fontWeight: 700,
    color: PALETTE.ink,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  row: {
    flexDirection: 'row',
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderTopWidth: 1,
    borderTopColor: PALETTE.divider,
    borderTopStyle: 'solid',
  },
  td: {
    fontSize: 8,
    color: PALETTE.body,
  },
  tdMono: {
    fontSize: 8,
    fontFamily: 'JetBrains Mono',
    color: PALETTE.ink,
  },
  alignRight: { textAlign: 'right' },
  alignLeft: { textAlign: 'left' },
  alignCenter: { textAlign: 'center' },
  empty: {
    paddingVertical: 16,
    paddingHorizontal: 4,
    fontSize: 9,
    color: PALETTE.muted,
    textAlign: 'center',
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
})

export type ReportPdfColumn<Row> = {
  header: string
  /** Width as a CSS-like percentage string ("12%") or a flex weight number. */
  width: string
  align?: 'left' | 'right' | 'center'
  mono?: boolean
  cell: (row: Row) => string
}

export type ReportPdfTotalCell = {
  label: string
  value: string
}

export type ReportPdfData<Row> = {
  title: string
  subtitle?: string
  tenantLabel: string
  range: { from: string; to: string }
  printedOn: string
  totals?: ReadonlyArray<ReportPdfTotalCell>
  columns: ReadonlyArray<ReportPdfColumn<Row>>
  rows: ReadonlyArray<Row>
  emptyMessage: string
  footerNote?: string
}

function alignStyle(a?: 'left' | 'right' | 'center') {
  if (a === 'right') return styles.alignRight
  if (a === 'center') return styles.alignCenter
  return styles.alignLeft
}

export default function ReportPDF<Row>({ data }: { data: ReportPdfData<Row> }) {
  return (
    <Document title={data.title}>
      <Page size="LETTER" style={styles.page} wrap orientation="landscape">
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.brand}>{data.tenantLabel}</Text>
            <Text style={styles.title}>{data.title}</Text>
            {data.subtitle ? (
              <Text style={styles.subline}>{data.subtitle}</Text>
            ) : null}
          </View>
          <View style={styles.rangeBadge}>
            <Text style={styles.rangeKicker}>RANGE</Text>
            <Text style={styles.rangeText}>
              {data.range.from} — {data.range.to}
            </Text>
            <Text style={styles.subline}>Printed {data.printedOn}</Text>
          </View>
        </View>

        <View style={styles.divider} />

        {data.totals && data.totals.length > 0 ? (
          <>
            <View style={styles.totalsRow}>
              {data.totals.map((t, i) => (
                <View key={i} style={styles.totalCell}>
                  <Text style={styles.totalLabel}>{t.label}</Text>
                  <Text style={styles.totalValue}>{t.value}</Text>
                </View>
              ))}
            </View>
            <View style={styles.divider} />
          </>
        ) : null}

        <View style={styles.tableHeader} fixed>
          {data.columns.map((c, i) => (
            <Text
              key={i}
              style={[
                styles.th,
                alignStyle(c.align),
                { width: c.width },
              ]}
            >
              {c.header}
            </Text>
          ))}
        </View>

        {data.rows.length === 0 ? (
          <Text style={styles.empty}>{data.emptyMessage}</Text>
        ) : (
          data.rows.map((r, i) => (
            <View key={i} style={styles.row} wrap={false}>
              {data.columns.map((c, j) => (
                <Text
                  key={j}
                  style={[
                    c.mono ? styles.tdMono : styles.td,
                    alignStyle(c.align),
                    { width: c.width },
                  ]}
                >
                  {c.cell(r)}
                </Text>
              ))}
            </View>
          ))
        )}

        <View style={styles.footer} fixed>
          <Text>{data.footerNote ?? data.tenantLabel}</Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              `${pageNumber} / ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  )
}
