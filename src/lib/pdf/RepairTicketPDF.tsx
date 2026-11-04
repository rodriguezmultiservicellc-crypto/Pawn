/**
 * Repair ticket PDF — bilingual EN+ES on one page (CLAUDE.md rule 6).
 *
 * The customer's copy at intake: who, what was received, the quote and
 * money so far, the promised date, the abandonment notice (days from the
 * tenant's jurisdiction — never a constant), the public tracking link, and
 * signature lines. Staff-only notes are NOT on it.
 */

import { Document, Page, Text, View } from '@react-pdf/renderer'
import type { Dictionary } from '@/lib/i18n/en'
import { pdfJoin, pdfMoney, pdfStyles as s, type PdfTenant } from './shared'

export type RepairTicketPDFLineItem = {
  title: string
  work_needed: string | null
  weight_grams: number | null
}

export type RepairTicketPDFStone = {
  stone_index: number
  stone_type: string
  shape: string | null
  size_mm: number | null
  weight_carats: number | null
  source: 'customer_supplied' | 'shop_supplied'
}

export type RepairTicketPDFData = {
  ticket_number: string
  created_at: string
  promised_date: string | null
  status: string
  service_type: string
  title: string
  item_description: string
  quote_amount: number | null
  deposit_amount: number
  paid_amount: number
  balance_due: number | null
  technician_name: string | null
  customer: { full_name: string; phone: string | null; email: string | null }
  tenant: PdfTenant
  line_items: ReadonlyArray<RepairTicketPDFLineItem>
  stones: ReadonlyArray<RepairTicketPDFStone>
  /** Jurisdiction's repair abandonment window; null hides the notice. */
  abandon_days: number | null
  tracking_url: string | null
  i18n: { en: Dictionary; es: Dictionary }
  printed_on: string
}

function Field({ en, es, value, mono }: { en: string; es: string; value: string; mono?: boolean }) {
  return (
    <View style={s.fieldCellThird}>
      <Text style={s.fieldLabel}>
        {en}
        <Text style={s.fieldLabelEs}> / {es}</Text>
      </Text>
      <Text style={mono ? s.fieldValueMono : s.fieldValue}>{value}</Text>
    </View>
  )
}

function Title({ en, es }: { en: string; es: string }) {
  return (
    <Text style={s.sectionTitle}>
      {en}
      <Text style={s.sectionTitleEs}> / {es}</Text>
    </Text>
  )
}

export default function RepairTicketPDF({ data }: { data: RepairTicketPDFData }) {
  const en = data.i18n.en.repair.print
  const es = data.i18n.es.repair.print
  const statusEn = (data.i18n.en.repair.statusBadges as Record<string, string>)[data.status] ?? data.status
  const statusEs = (data.i18n.es.repair.statusBadges as Record<string, string>)[data.status] ?? data.status
  const serviceKey = serviceTypeKey(data.service_type)
  const serviceEn = (data.i18n.en.repair.serviceTypes as Record<string, string>)[serviceKey] ?? data.service_type
  const serviceEs = (data.i18n.es.repair.serviceTypes as Record<string, string>)[serviceKey] ?? data.service_type

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
            <Text style={s.docNumber}>{data.ticket_number}</Text>
            <Text style={s.small}>
              {en.fields.date} / {es.fields.date}: {data.created_at.slice(0, 10)}
            </Text>
          </View>
        </View>

        <View style={s.divider} />

        <Title en={en.sections.customer} es={es.sections.customer} />
        <View style={s.fieldGrid}>
          <Field en={data.i18n.en.buy.print.customer.name} es={data.i18n.es.buy.print.customer.name} value={data.customer.full_name} />
          <Field en={data.i18n.en.buy.print.customer.phone} es={data.i18n.es.buy.print.customer.phone} value={data.customer.phone ?? '—'} mono />
          <Field en={en.fields.promised} es={es.fields.promised} value={data.promised_date ?? '—'} mono />
          <Field en={en.fields.service} es={es.fields.service} value={`${serviceEn} / ${serviceEs}`} />
          <Field en={en.fields.status} es={es.fields.status} value={`${statusEn} / ${statusEs}`} />
          <Field en={en.fields.technician} es={es.fields.technician} value={data.technician_name ?? '—'} />
        </View>

        <View style={s.divider} />

        <Title en={en.sections.items} es={es.sections.items} />
        <View style={s.table}>
          <View style={s.tableHeader}>
            <Text style={[s.tableHeaderCell, { width: '40%' }]}>
              {en.columns.item}
              <Text style={s.tableHeaderCellEs}> / {es.columns.item}</Text>
            </Text>
            <Text style={[s.tableHeaderCell, { width: '45%' }]}>
              {en.columns.work}
              <Text style={s.tableHeaderCellEs}> / {es.columns.work}</Text>
            </Text>
            <Text style={[s.tableHeaderCell, { width: '15%', textAlign: 'right' }]}>
              {en.columns.weight}
              <Text style={s.tableHeaderCellEs}> / {es.columns.weight}</Text>
            </Text>
          </View>
          {(data.line_items.length > 0
            ? data.line_items
            : [{ title: data.item_description, work_needed: data.title, weight_grams: null }]
          ).map((li, i) => (
            <View key={i} style={s.tableRow}>
              <Text style={[s.tableCell, { width: '40%' }]}>{li.title}</Text>
              <Text style={[s.tableCell, { width: '45%' }]}>{li.work_needed ?? '—'}</Text>
              <Text style={[s.tableCellMono, { width: '15%' }]}>
                {li.weight_grams == null ? '—' : `${Math.round(li.weight_grams * 1000) / 1000} g`}
              </Text>
            </View>
          ))}
        </View>

        {data.stones.length > 0 ? (
          <>
            <View style={{ marginTop: 8 }} />
            <Title en={en.sections.stones} es={es.sections.stones} />
            <View style={s.table}>
              <View style={s.tableHeader}>
                <Text style={[s.tableHeaderCell, { width: '10%' }]}>#</Text>
                <Text style={[s.tableHeaderCell, { width: '60%' }]}>
                  {en.columns.stone}
                  <Text style={s.tableHeaderCellEs}> / {es.columns.stone}</Text>
                </Text>
                <Text style={[s.tableHeaderCell, { width: '30%' }]}>
                  {en.columns.source}
                  <Text style={s.tableHeaderCellEs}> / {es.columns.source}</Text>
                </Text>
              </View>
              {data.stones.map((st) => (
                <View key={st.stone_index} style={s.tableRow}>
                  <Text style={[s.tableCell, { width: '10%' }]}>{st.stone_index}</Text>
                  <Text style={[s.tableCell, { width: '60%' }]}>
                    {[st.stone_type, st.shape, st.size_mm != null ? `${st.size_mm} mm` : null, st.weight_carats != null ? `${st.weight_carats} ct` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                  <Text style={[s.tableCell, { width: '30%' }]}>
                    {en.stoneSource[st.source]} / {es.stoneSource[st.source]}
                  </Text>
                </View>
              ))}
            </View>
          </>
        ) : null}

        <View style={s.totalsRow}>
          <View style={s.totalsBox}>
            <View style={s.totalsLine}>
              <Text style={s.totalsLabel}>
                {en.fields.quote} / {es.fields.quote}
              </Text>
              <Text style={s.totalsValue}>
                {data.quote_amount == null ? `${en.quotePending} / ${es.quotePending}` : pdfMoney(data.quote_amount)}
              </Text>
            </View>
            <View style={s.totalsLine}>
              <Text style={s.totalsLabel}>
                {en.fields.deposit} / {es.fields.deposit}
              </Text>
              <Text style={s.totalsValue}>{pdfMoney(data.deposit_amount)}</Text>
            </View>
            <View style={s.totalsLine}>
              <Text style={s.totalsLabel}>
                {en.fields.paid} / {es.fields.paid}
              </Text>
              <Text style={s.totalsValue}>{pdfMoney(data.paid_amount)}</Text>
            </View>
            <View style={s.totalsGrand}>
              <Text style={s.totalsGrandLabel}>
                {en.fields.balance} / {es.fields.balance}
              </Text>
              <Text style={s.totalsGrandValue}>{data.balance_due == null ? '—' : pdfMoney(data.balance_due)}</Text>
            </View>
          </View>
        </View>

        {data.tracking_url ? (
          <View style={s.noticeBox}>
            <Text style={s.noticeTitle}>
              {en.fields.tracking} / {es.fields.tracking}
            </Text>
            {/* Body font on purpose: JetBrains Mono's "//" ligature makes fontkit
                throw "Offset is outside the bounds of the DataView" on WOFF
                (see lib/pdf/shared.ts). URLs never go in the mono face. */}
            <Text style={s.noticeText}>{data.tracking_url}</Text>
          </View>
        ) : null}

        <View style={s.noticeBox}>
          <Text style={s.noticeTitle}>
            {en.sections.terms} / {es.sections.terms}
          </Text>
          {data.abandon_days != null ? (
            <>
              <Text style={s.noticeText}>{en.abandonNotice.replace('{days}', String(data.abandon_days))}</Text>
              <Text style={s.noticeTextEs}>{es.abandonNotice.replace('{days}', String(data.abandon_days))}</Text>
            </>
          ) : null}
          <Text style={[s.noticeText, { marginTop: 3 }]}>{en.liabilityNotice}</Text>
          <Text style={s.noticeTextEs}>{es.liabilityNotice}</Text>
        </View>

        <View style={s.signatureGrid}>
          <View style={s.signatureCell}>
            <View style={s.signatureLine} />
            <Text style={s.signatureLabel}>
              {en.signatureCustomer} / {es.signatureCustomer}
            </Text>
          </View>
          <View style={s.signatureCell}>
            <View style={s.signatureLine} />
            <Text style={s.signatureLabel}>
              {en.signatureStaff} / {es.signatureStaff}
            </Text>
          </View>
        </View>

        <View style={s.footer} fixed>
          <Text>
            {en.printedOn} / {es.printedOn}: {data.printed_on}
          </Text>
          <Text style={s.footerMono}>{data.ticket_number}</Text>
        </View>
      </Page>
    </Document>
  )
}

function serviceTypeKey(type: string): string {
  return type === 'stone_setting' ? 'stoneSetting' : type
}
