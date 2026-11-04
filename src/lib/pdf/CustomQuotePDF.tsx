/**
 * Custom-piece quote PDF — customer-facing, bilingual EN+ES on one page.
 *
 * Shows the piece, the total, deposit and balance, validity, the frozen
 * metal price note, and — ONLY when the shop enabled it — the price lines.
 * Costs and margin never appear here; the renderer does not even receive
 * them.
 */

import { Document, Page, Text, View } from '@react-pdf/renderer'
import type { Dictionary } from '@/lib/i18n/en'
import { pdfJoin, pdfMoney, pdfStyles as s, type PdfTenant } from './shared'

export type CustomQuotePDFLine = { label: string; quantity: number; price_total: number }

export type CustomQuotePDFData = {
  quote_number: string
  created_at: string
  expires_on: string | null
  status: string
  category: string
  description: string
  size: string | null
  price_total: number
  deposit_amount: number
  balance_due: number
  spot_priced_at: string | null
  spot_price_per_gram: number | null
  spot_metal_label: string | null
  customer_name: string
  tenant: PdfTenant
  /** Empty when the shop keeps the breakdown private. */
  lines: ReadonlyArray<CustomQuotePDFLine>
  i18n: { en: Dictionary; es: Dictionary }
  printed_on: string
}

export default function CustomQuotePDF({ data }: { data: CustomQuotePDFData }) {
  const en = data.i18n.en.quotes.print
  const es = data.i18n.es.quotes.print
  const catEn = (data.i18n.en.quotes.categories as Record<string, string>)[data.category] ?? data.category
  const catEs = (data.i18n.es.quotes.categories as Record<string, string>)[data.category] ?? data.category

  return (
    <Document>
      <Page size="LETTER" style={s.page}>
        <View style={s.headerRow}>
          <View style={s.headerTenantBlock}>
            <Text style={s.tenantName}>{data.tenant.dba?.trim() || data.tenant.name}</Text>
            <Text style={s.tenantSubline}>
              {pdfJoin([data.tenant.address, data.tenant.city, data.tenant.state, data.tenant.zip])}
            </Text>
            {data.tenant.phone || data.tenant.email ? (
              <Text style={s.tenantSubline}>{[data.tenant.phone, data.tenant.email].filter(Boolean).join(' · ')}</Text>
            ) : null}
          </View>
          <View style={s.badge}>
            <Text style={s.kicker}>
              {en.header}
              <Text style={s.kickerEs}> / {es.header}</Text>
            </Text>
            <Text style={s.docNumber}>{data.quote_number}</Text>
            <Text style={s.small}>
              {en.date} / {es.date}: {data.created_at.slice(0, 10)}
            </Text>
            {data.expires_on ? (
              <Text style={s.small}>
                {en.validUntil} / {es.validUntil}: {data.expires_on}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={s.divider} />

        <View style={s.fieldGrid}>
          <View style={s.fieldCell}>
            <Text style={s.fieldLabel}>
              {en.preparedFor}
              <Text style={s.fieldLabelEs}> / {es.preparedFor}</Text>
            </Text>
            <Text style={s.fieldValue}>{data.customer_name}</Text>
          </View>
          <View style={s.fieldCell}>
            <Text style={s.fieldLabel}>
              {en.piece}
              <Text style={s.fieldLabelEs}> / {es.piece}</Text>
            </Text>
            <Text style={s.fieldValue}>
              {catEn} / {catEs}
            </Text>
          </View>
          <View style={[s.fieldCell, { width: '100%' }]}>
            <Text style={s.fieldValue}>{data.description}</Text>
            {data.size ? (
              <Text style={s.tenantSubline}>
                {en.size} / {es.size}: {data.size}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={s.divider} />

        {data.lines.length > 0 ? (
          <>
            <Text style={s.sectionTitle}>
              {en.included}
              <Text style={s.sectionTitleEs}> / {es.included}</Text>
            </Text>
            <View style={s.table}>
              <View style={s.tableHeader}>
                <Text style={[s.tableHeaderCell, { width: '64%' }]}>
                  {en.columns.item}
                  <Text style={s.tableHeaderCellEs}> / {es.columns.item}</Text>
                </Text>
                <Text style={[s.tableHeaderCell, { width: '12%', textAlign: 'right' }]}>
                  {en.columns.qty}
                  <Text style={s.tableHeaderCellEs}> / {es.columns.qty}</Text>
                </Text>
                <Text style={[s.tableHeaderCell, { width: '24%', textAlign: 'right' }]}>
                  {en.columns.price}
                  <Text style={s.tableHeaderCellEs}> / {es.columns.price}</Text>
                </Text>
              </View>
              {data.lines.map((l, i) => (
                <View key={i} style={s.tableRow}>
                  <Text style={[s.tableCell, { width: '64%' }]}>{l.label}</Text>
                  <Text style={[s.tableCellMono, { width: '12%' }]}>{Math.round(l.quantity * 10000) / 10000}</Text>
                  <Text style={[s.tableCellMono, { width: '24%' }]}>{pdfMoney(l.price_total)}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}

        <View style={s.totalsRow}>
          <View style={s.totalsBox}>
            <View style={s.totalsGrand}>
              <Text style={s.totalsGrandLabel}>
                {en.total} / {es.total}
              </Text>
              <Text style={s.totalsGrandValue}>{pdfMoney(data.price_total)}</Text>
            </View>
            <View style={s.totalsLine}>
              <Text style={s.totalsLabel}>
                {en.deposit} / {es.deposit}
              </Text>
              <Text style={s.totalsValue}>{pdfMoney(data.deposit_amount)}</Text>
            </View>
            <View style={s.totalsLine}>
              <Text style={s.totalsLabel}>
                {en.balance} / {es.balance}
              </Text>
              <Text style={s.totalsValue}>{pdfMoney(data.balance_due)}</Text>
            </View>
          </View>
        </View>

        <View style={s.noticeBox}>
          {data.spot_price_per_gram != null && data.spot_priced_at ? (
            <>
              <Text style={s.noticeText}>
                {en.pricedAt.replace('{price}', pdfMoney(data.spot_price_per_gram)).replace('{date}', data.spot_priced_at.slice(0, 10))}
                {data.spot_metal_label ? ` (${data.spot_metal_label})` : ''}
              </Text>
              <Text style={s.noticeTextEs}>
                {es.pricedAt.replace('{price}', pdfMoney(data.spot_price_per_gram)).replace('{date}', data.spot_priced_at.slice(0, 10))}
              </Text>
            </>
          ) : null}
          <Text style={[s.noticeText, { marginTop: 3 }]}>{en.terms}</Text>
          <Text style={s.noticeTextEs}>{es.terms}</Text>
        </View>

        <View style={s.signatureGrid}>
          <View style={s.signatureCell}>
            <View style={s.signatureLine} />
            <Text style={s.signatureLabel}>
              {en.acceptedBy} / {es.acceptedBy}
            </Text>
          </View>
          <View style={s.signatureCell}>
            <View style={s.signatureLine} />
            <Text style={s.signatureLabel}>
              {en.acceptedDate} / {es.acceptedDate}
            </Text>
          </View>
        </View>

        <View style={s.footer} fixed>
          <Text>
            {en.printedOn} / {es.printedOn}: {data.printed_on}
          </Text>
          <Text style={s.footerMono}>{data.quote_number}</Text>
        </View>
      </Page>
    </Document>
  )
}
