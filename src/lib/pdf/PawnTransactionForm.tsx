/**
 * The front of the pawn ticket: the pawnbroker transaction form.
 *
 * Laid out after the form the shop's customers already know (the Florida
 * Pawnbroker Transaction Form): control number and barcode on top, the
 * pledgor block, one block per pledged item, the Truth in Lending boxes, the
 * default date, the pledgor's statement, signature and thumb print.
 *
 * Rules
 *   - Every label is bilingual (CLAUDE.md rule 6): "English / Español".
 *   - No statutory wording lives here. The statements printed above the
 *     signature are the jurisdiction's own notices (rule 18), EN beside ES.
 *   - Every figure is handed in by render-loan-ticket (figured with the same
 *     loan math the app charges with). Nothing is computed in this file.
 *   - One sheet per copy ("Customer copy" / "Store copy"). The lending boxes
 *     and the signature stay together at the foot; a ticket with more items
 *     than fit above them flows onto a second sheet rather than shrinking
 *     the type.
 */

import { Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import { reportColors } from '@/lib/tokens'
import { bi as bl, money } from '@/lib/pos/receipt-thermal'
import type { PawnTicketCollateral, PawnTicketData } from './PawnTicketPDF'

const INK = reportColors.ink
const LINE = '#222222'
const SOFT = reportColors.muted

const s = StyleSheet.create({
  page: { paddingTop: 20, paddingBottom: 20, paddingHorizontal: 28, fontFamily: 'Inter', fontSize: 8, color: INK },
  row: { flexDirection: 'row' },
  // header
  title: { fontSize: 9.5, fontWeight: 700, letterSpacing: 0.2 },
  small: { fontSize: 6, color: SOFT },
  shop: { fontSize: 12, fontWeight: 700, marginTop: 2 },
  shopLine: { fontSize: 8.5 },
  controlBox: { backgroundColor: INK, paddingVertical: 4, paddingHorizontal: 8, minWidth: 104, alignItems: 'flex-end' },
  controlNo: { color: '#ffffff', fontSize: 16, fontWeight: 700, fontFamily: 'JetBrains Mono' },
  copy: { fontSize: 10, fontWeight: 700, color: SOFT, textAlign: 'right', marginTop: 2 },
  box: { borderWidth: 0.8, borderColor: LINE },
  // cells
  cell: { paddingHorizontal: 3, paddingTop: 1.5, paddingBottom: 2, borderRightWidth: 0.5, borderRightColor: LINE, minHeight: 21 },
  cellLast: { borderRightWidth: 0 },
  rowLine: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: LINE },
  label: { fontSize: 5.2, color: SOFT },
  value: { fontSize: 8.6, fontWeight: 600, marginTop: 1 },
  mono: { fontFamily: 'JetBrains Mono' },
  band: { backgroundColor: INK, color: '#ffffff', fontSize: 8.5, fontWeight: 700, textAlign: 'center', paddingVertical: 2.5 },
  // truth in lending
  tilCell: { flex: 1, paddingHorizontal: 4, paddingVertical: 3, borderRightWidth: 0.5, borderRightColor: LINE, minHeight: 46 },
  tilHead: { fontSize: 7.6, fontWeight: 700 },
  tilSub: { fontSize: 5.2, color: SOFT, marginTop: 1 },
  tilValue: { fontSize: 12, fontWeight: 700, fontFamily: 'JetBrains Mono', textAlign: 'right', marginTop: 3 },
  // statements + signature
  notice: { fontSize: 6, lineHeight: 1.25, marginBottom: 2 },
  sigLine: { borderTopWidth: 0.8, borderTopColor: LINE, marginTop: 2, paddingTop: 1.5 },
  thumb: { width: 78, height: 68, borderWidth: 0.8, borderColor: LINE },
})

type FormLabels = PawnTicketData['i18n']['en']['pawn']['print']['form']
type InventoryWords = PawnTicketData['i18n']['en']['inventory']

/** 2026-09-16 → 9/16/2026 (a calendar date, no timezone shift). */
const mdy = (iso: string | null): string => {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  return y && m && d ? `${Number(m)}/${Number(d)}/${y}` : iso
}

const feetInches = (inches: number | null): string =>
  inches && inches > 0 ? `${Math.floor(inches / 12)}'${inches % 12}"` : ''

const txt = (v: string | number | null | undefined): string => (v == null ? '' : String(v).trim())

// ── Code 39 ────────────────────────────────────────────────────────────────
// Nine elements per character, bar first, alternating bar / space; 1 = wide.
const CODE39: Record<string, string> = {
  '0': '000110100', '1': '100100001', '2': '001100001', '3': '101100000', '4': '000110001',
  '5': '100110000', '6': '001110000', '7': '000100101', '8': '100100100', '9': '001100100',
  A: '100001001', B: '001001001', C: '101001000', D: '000011001', E: '100011000', F: '001011000',
  G: '000001101', H: '100001100', I: '001001100', J: '000011100', K: '100000011', L: '001000011',
  M: '101000010', N: '000010011', O: '100010010', P: '001010010', Q: '000000111', R: '100000110',
  S: '001000110', T: '000010110', U: '110000001', V: '011000001', W: '111000000', X: '010010001',
  Y: '110010000', Z: '011010000', '-': '010000101', '*': '010010100',
}

/** Bar / space widths for a Code 39 symbol, or null when a character has no code. */
export function code39Widths(text: string): Array<{ bar: boolean; w: number }> | null {
  const chars = `*${text.toUpperCase()}*`.split('')
  const out: Array<{ bar: boolean; w: number }> = []
  for (let c = 0; c < chars.length; c++) {
    const pattern = CODE39[chars[c]]
    if (!pattern) return null
    for (let i = 0; i < 9; i++) out.push({ bar: i % 2 === 0, w: pattern[i] === '1' ? 2.5 : 1 })
    if (c < chars.length - 1) out.push({ bar: false, w: 1 })
  }
  return out
}

function Barcode({ text }: { text: string }) {
  const parts = code39Widths(text)
  if (!parts) return null
  const unit = 0.85
  return (
    <View style={{ flexDirection: 'row', height: 20 }}>
      {parts.map((p, i) => (
        <View key={i} style={{ width: p.w * unit, height: 20, backgroundColor: p.bar ? '#000000' : '#ffffff' }} />
      ))}
    </View>
  )
}

function Cell({
  label,
  value,
  flex = 1,
  last = false,
  mono = false,
}: {
  label: string
  value?: string
  flex?: number
  last?: boolean
  mono?: boolean
}) {
  return (
    <View style={[s.cell, { flex }, last ? s.cellLast : {}]}>
      <Text style={s.label}>{label}</Text>
      <Text style={[s.value, mono ? s.mono : {}]}>{value || ' '}</Text>
    </View>
  )
}

function Check({ on, label }: { on: boolean; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 8 }}>
      <View style={{ width: 8, height: 8, borderWidth: 0.8, borderColor: LINE, alignItems: 'center', justifyContent: 'center' }}>
        {on ? <View style={{ width: 4.6, height: 4.6, backgroundColor: INK }} /> : null}
      </View>
      <Text style={{ fontSize: 8, marginLeft: 3 }}>{label}</Text>
    </View>
  )
}

/**
 * One pledged item. Two rows for any item; a third only for a firearm
 * (action, caliber, finish, barrels, barrel length).
 */
function ItemBlock({
  item,
  no,
  en,
  es,
  kind,
  metal,
  barrelLength,
}: {
  item: PawnTicketCollateral
  no: number
  en: FormLabels
  es: FormLabels
  /** What the piece is, both languages (a firearm: its kind). */
  kind: string
  /** The metal in words, both languages ("Gold / Oro"); '' when none. */
  metal: string
  /** "Barrel length" in both languages. */
  barrelLength: string
}) {
  const serial =
    txt(item.firearm_serial_number) || txt(item.electronic_serial) || txt(item.jewelry_serial)
  const brand =
    txt(item.firearm_make) || txt(item.electronic_brand) || txt(item.tool_brand) || txt(item.jewelry_brand)
  const model =
    txt(item.firearm_model) || txt(item.electronic_model) || txt(item.tool_model) || txt(item.jewelry_model)
  const genderKey = item.jewelry_gender as keyof FormLabels['genders'] | null
  const gender =
    genderKey && en.genders[genderKey] ? bl(en.genders[genderKey], es.genders[genderKey]) : ''
  const brandModel = [brand, model].filter(Boolean).join(' ')
  const firearm = Boolean(item.firearm_type || item.firearm_caliber || item.firearm_serial_number)
  return (
    <View wrap={false} style={{ borderBottomWidth: 0.8, borderBottomColor: LINE, flexDirection: 'row' }}>
      <View style={{ width: 24, alignItems: 'center', paddingTop: 2, borderRightWidth: 0.5, borderRightColor: LINE }}>
        <Text style={s.label}>{en.itemNo}</Text>
        <Text style={{ fontSize: 11, fontWeight: 700, marginTop: 5 }}>{no}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={s.rowLine}>
          <Cell label={bl(en.itemType, es.itemType)} value={kind} flex={1.9} />
          <Cell label={bl(en.description, es.description)} value={item.description} flex={4.6} />
          <Cell label={bl(en.serialNo, es.serialNo)} value={serial} flex={1.6} mono />
          <Cell label={`${bl(en.brand, es.brand)} · ${bl(en.model, es.model)}`} value={brandModel} flex={1.7} />
          <Cell label={bl(en.amount, es.amount)} value={money(item.est_value)} flex={1.2} mono last />
        </View>
        <View style={firearm ? s.rowLine : s.row}>
          <Cell label={bl(en.metal, es.metal)} value={metal} flex={1.4} />
          <Cell label={bl(en.karat, es.karat)} value={item.karat ? `${Number(item.karat.toFixed(1))}` : ''} flex={0.9} mono />
          <Cell label={bl(en.weight, es.weight)} value={item.weight_grams ? `${Number(item.weight_grams.toFixed(2))} g` : ''} flex={1} mono />
          <Cell label={bl(en.size, es.size)} value={txt(item.jewelry_size)} flex={0.8} />
          <Cell label={bl(en.style, es.style)} value={txt(item.jewelry_style)} flex={1.3} />
          <Cell label={bl(en.gender, es.gender)} value={gender} flex={1.7} />
          <Cell label={bl(en.color, es.color)} value={txt(item.color)} flex={1.2} />
          <Cell label={bl(en.stones, es.stones)} value={txt(item.gemstone_description)} flex={2.5} />
          <Cell label={bl(en.marks, es.marks)} value={txt(item.unique_marks)} flex={1.6} last />
        </View>
        {firearm ? (
          <View style={s.row}>
            <Cell label={bl(en.action, es.action)} value={txt(item.firearm_action_type)} flex={2} />
            <Cell label={bl(en.caliber, es.caliber)} value={txt(item.firearm_caliber)} flex={1.5} />
            <Cell label={bl(en.finish, es.finish)} value={txt(item.firearm_finish)} flex={1.5} />
            <Cell label={bl(en.barrels, es.barrels)} value={txt(item.firearm_number_of_barrels)} flex={1} />
            <Cell
              label={barrelLength}
              value={item.firearm_barrel_length_inches ? `${item.firearm_barrel_length_inches}"` : ''}
              flex={1.4}
              last
            />
          </View>
        ) : null}
      </View>
    </View>
  )
}

export function TransactionFormPage({ data, copy }: { data: PawnTicketData; copy: 'customer' | 'store' }) {
  const en: FormLabels = data.i18n.en.pawn.print.form
  const es: FormLabels = data.i18n.es.pawn.print.form
  const ne = data.i18n.en.pawn.new_
  const ns = data.i18n.es.pawn.new_
  const ie: InventoryWords = data.i18n.en.inventory
  const is: InventoryWords = data.i18n.es.inventory

  const firearmKind = (v: string | null, d: typeof ne): string | null =>
    v === 'handgun'
      ? d.itemFirearmTypeHandgun
      : v === 'rifle'
        ? d.itemFirearmTypeRifle
        : v === 'shotgun'
          ? d.itemFirearmTypeShotgun
          : v === 'other'
            ? d.itemFirearmTypeOther
            : null
  const kindOf = (item: PawnTicketCollateral): string => {
    const key = item.category as keyof FormLabels['categories']
    return bl(
      firearmKind(item.firearm_type, ne) ?? en.categories[key] ?? item.category,
      firearmKind(item.firearm_type, ns) ?? es.categories[key] ?? item.category,
    )
  }
  // gold -> metalGold, white_gold -> metalWhiteGold: the inventory's own words.
  const metalWords = (m: string | null): string => {
    if (!m || m === 'none') return ''
    const key = `metal${m
      .split('_')
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join('')}` as keyof InventoryWords
    const a = ie[key]
    const b = is[key]
    return typeof a === 'string' && typeof b === 'string' ? bl(a, b) : m.replace(/_/g, ' ')
  }

  const t = data.tenant
  const c = data.customer
  const shop = t.dba?.trim() || t.name
  const cityLine = [t.city, [t.state, t.zip].filter(Boolean).join(' ')].filter((p) => p && p.trim()).join(', ')
  const residence = [c.address1, c.address2, c.city, [c.state, c.zip].filter(Boolean).join(' ')]
    .filter((p) => p && String(p).trim())
    .join(', ')
  const closed = data.status === 'redeemed' || data.status === 'forfeited' || data.status === 'voided'
  const closedKey = data.status as 'redeemed' | 'forfeited' | 'voided'
  const idKey = c.id_type as keyof FormLabels['idTypes'] | null

  return (
    <Page size="LETTER" style={s.page} wrap>
      {/* ── Header: form title + shop · barcode + date · control number */}
      <View style={[s.row, { justifyContent: 'space-between', alignItems: 'flex-start' }]} wrap={false}>
        <View style={{ flex: 1, paddingRight: 8 }}>
          <Text style={s.title}>
            {[data.jurisdiction_name?.toUpperCase(), en.title.toUpperCase()].filter(Boolean).join(' ')}
          </Text>
          <Text style={s.small}>{es.title}</Text>
          <Text style={[s.small, { marginTop: 3 }]}>{bl(en.pawnbroker, es.pawnbroker)}:</Text>
          <Text style={s.shop}>{shop}</Text>
          {t.address ? <Text style={s.shopLine}>{t.address}</Text> : null}
          {cityLine ? <Text style={s.shopLine}>{cityLine}</Text> : null}
          {t.phone ? <Text style={s.shopLine}>{t.phone}</Text> : null}
        </View>
        <View style={{ width: 176, alignItems: 'center', paddingTop: 6 }}>
          <Barcode text={data.ticket_number} />
          <View style={[s.box, { marginTop: 8, paddingHorizontal: 6, paddingVertical: 3, width: 176 }]}>
            <View style={[s.row, { justifyContent: 'space-between', alignItems: 'center' }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 7.5 }}>{en.transactionDate}</Text>
                <Text style={s.small}>{es.transactionDate}</Text>
              </View>
              <Text style={{ fontSize: 9.5, fontWeight: 700 }}>{mdy(data.issue_date)}</Text>
            </View>
            <View style={[s.row, { justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }]}>
              <Text style={{ fontSize: 7.5, flex: 1 }}>{bl(en.time, es.time)}</Text>
              <Text style={{ fontSize: 9.5, fontWeight: 700 }}>{data.transaction_time}</Text>
            </View>
          </View>
        </View>
        <View style={{ width: 178, alignItems: 'flex-end' }}>
          <View style={[s.row, { alignItems: 'center' }]}>
            <View style={{ marginRight: 6, alignItems: 'flex-end' }}>
              <Text style={{ fontSize: 8 }}>{en.controlNo}</Text>
              <Text style={s.small}>{es.controlNo}</Text>
            </View>
            <View style={s.controlBox}>
              <Text style={s.controlNo}>{data.ticket_number}</Text>
            </View>
          </View>
          <Text style={s.copy}>
            {copy === 'store' ? bl(en.storeCopy, es.storeCopy) : bl(en.customerCopy, es.customerCopy)}
          </Text>
          {closed ? (
            <Text style={{ fontSize: 8, fontWeight: 700, marginTop: 1 }}>
              {bl(en.status[closedKey], es.status[closedKey]).toUpperCase()}
            </Text>
          ) : null}
          <View style={[s.row, { marginTop: 5, alignItems: 'center' }]}>
            <View style={{ marginRight: 8, alignItems: 'flex-end' }}>
              <Text style={{ fontSize: 8 }}>{en.maturityDate}</Text>
              <Text style={s.small}>{es.maturityDate}</Text>
            </View>
            <Text style={{ fontSize: 10.5, fontWeight: 700 }}>{mdy(data.due_date)}</Text>
          </View>
        </View>
      </View>

      <View style={[s.row, { justifyContent: 'flex-end', alignItems: 'center', marginTop: 4, marginBottom: 3 }]}>
        <Text style={{ fontSize: 8 }}>{bl(en.typeOfTransaction, es.typeOfTransaction)}:</Text>
        <Check on={false} label={bl(en.typePurchase, es.typePurchase)} />
        <Check on={false} label={bl(en.typeConsignment, es.typeConsignment)} />
        <Check on label={bl(en.typePawn, es.typePawn)} />
      </View>

      {/* ── Pledgor / seller */}
      <View style={s.box} wrap={false}>
        <Text style={s.band}>{bl(en.pledgor, es.pledgor).toUpperCase()}</Text>
        <View style={s.rowLine}>
          <Cell label={bl(en.lastName, es.lastName)} value={c.last_name} flex={2.2} />
          <Cell label={bl(en.firstName, es.firstName)} value={c.first_name} flex={2.2} />
          <Cell label={bl(en.middleName, es.middleName)} value={txt(c.middle_name)} flex={1.6} />
          <Cell label={bl(en.dob, es.dob)} value={mdy(c.date_of_birth)} flex={1.5} mono />
          <Cell label={bl(en.sex, es.sex)} value={txt(c.sex)} flex={0.7} />
          <Cell label={bl(en.race, es.race)} value={txt(c.race)} flex={1.3} last />
        </View>
        <View style={s.rowLine}>
          <Cell label={bl(en.residence, es.residence)} value={residence} flex={6} />
          <Cell label={bl(en.homePhone, es.homePhone)} value={txt(c.phone)} flex={2} mono last />
        </View>
        <View style={s.rowLine}>
          <Cell label={bl(en.employment, es.employment)} value={txt(c.place_of_employment)} flex={6} />
          <Cell label={bl(en.businessPhone, es.businessPhone)} value={txt(c.phone_alt)} flex={2} mono last />
        </View>
        <View style={s.row}>
          <Cell label={bl(en.idNumber, es.idNumber)} value={txt(c.id_number)} flex={2.6} mono />
          <Cell
            label={bl(en.idType, es.idType)}
            value={idKey ? bl(en.idTypes[idKey] ?? idKey, es.idTypes[idKey] ?? idKey) : ''}
            flex={1.5}
          />
          <Cell label={bl(en.idState, es.idState)} value={txt(c.id_state)} flex={1} />
          <Cell label={bl(en.height, es.height)} value={feetInches(c.height_inches)} flex={0.9} mono />
          <Cell label={bl(en.weightLbs, es.weightLbs)} value={c.weight_lbs ? String(c.weight_lbs) : ''} flex={0.9} mono />
          <Cell label={bl(en.eyes, es.eyes)} value={txt(c.eye_color)} flex={1} />
          <Cell label={bl(en.hair, es.hair)} value={txt(c.hair_color)} flex={1} />
          <Cell label={bl(en.identifyingMarks, es.identifyingMarks)} value={txt(c.identifying_marks)} flex={2.4} last />
        </View>
      </View>

      {/* ── Pledged goods */}
      <View style={[s.box, { marginTop: 4, borderBottomWidth: 0 }]}>
        <Text style={s.band}>{en.securityInterest}</Text>
        <Text style={{ fontSize: 6, textAlign: 'center', paddingVertical: 1.5, borderBottomWidth: 0.5, borderBottomColor: LINE }}>
          {es.securityInterest}
        </Text>
        {data.collateral.map((item, i) => (
          <ItemBlock
            key={i}
            item={item}
            no={i + 1}
            en={en}
            es={es}
            kind={kindOf(item)}
            metal={metalWords(item.metal_type)}
            barrelLength={bl(ne.itemFirearmBarrelLength, ns.itemFirearmBarrelLength)}
          />
        ))}
        {data.collateral.length === 0 ? (
          <Text style={{ padding: 8, fontSize: 8, borderBottomWidth: 0.8, borderBottomColor: LINE }}>—</Text>
        ) : null}
      </View>

      {/* ── The foot of the sheet: lending boxes, statements, signature.
            One unbreakable block pinned to the bottom margin. */}
      <View style={{ marginTop: 'auto', paddingTop: 6 }} wrap={false}>
        <View style={s.box}>
          <Text style={s.band}>{bl(en.truthInLending, es.truthInLending).toUpperCase()}</Text>
          <View style={s.row}>
            <View style={s.tilCell}>
              <Text style={s.tilHead}>{en.amountFinanced.toUpperCase()}</Text>
              <Text style={s.tilSub}>{es.amountFinanced} — {bl(en.amountFinancedHelp, es.amountFinancedHelp)}</Text>
              <Text style={s.tilValue}>{money(data.principal)}</Text>
            </View>
            <View style={s.tilCell}>
              <Text style={s.tilHead}>{en.financeCharge.toUpperCase()}</Text>
              <Text style={s.tilSub}>{es.financeCharge} — {bl(en.financeChargeHelp, es.financeChargeHelp)}</Text>
              <Text style={s.tilValue}>{money(data.total_interest_at_term)}</Text>
            </View>
            <View style={s.tilCell}>
              <Text style={s.tilHead}>{en.totalOfPayments.toUpperCase()}</Text>
              <Text style={s.tilSub}>{es.totalOfPayments} — {bl(en.totalOfPaymentsHelp, es.totalOfPaymentsHelp)}</Text>
              <Text style={s.tilValue}>{money(data.total_payoff_at_term)}</Text>
            </View>
            <View style={s.tilCell}>
              <Text style={s.tilHead}>{en.apr.toUpperCase()}</Text>
              <Text style={s.tilSub}>{es.apr} — {bl(en.aprHelp, es.aprHelp)}</Text>
              <Text style={s.tilValue}>{`${(data.apr * 100).toFixed(2)}%`}</Text>
            </View>
            <View style={[s.tilCell, { borderRightWidth: 0 }]}>
              <Text style={s.tilHead}>{en.maturityDate.toUpperCase()}</Text>
              <Text style={s.tilSub}>{es.maturityDate}</Text>
              <Text style={s.tilValue}>{mdy(data.due_date)}</Text>
            </View>
          </View>
          <View style={[s.row, { borderTopWidth: 0.5, borderTopColor: LINE }]}>
            <Text style={{ flex: 1, fontSize: 6, padding: 2.5 }}>{bl(en.seeContract, es.seeContract)}</Text>
            <Text style={{ flex: 1, fontSize: 6, padding: 2.5, textAlign: 'right' }}>
              {bl(en.paymentSchedule, es.paymentSchedule)}
            </Text>
          </View>
        </View>

        {/* The jurisdiction's statements, English beside Spanish. A shop with
            no jurisdiction on file prints the placeholder instead, so the
            missing legal text is impossible to overlook. */}
        {data.legal_notices.length === 0 ? (
          <View style={[s.row, { marginTop: 4 }]}>
            <Text style={[s.notice, { flex: 1, paddingRight: 6 }]}>{data.i18n.en.pawn.print.legal.placeholder}</Text>
            <Text style={[s.notice, { flex: 1, paddingLeft: 6 }]}>{data.i18n.es.pawn.print.legal.placeholder}</Text>
          </View>
        ) : null}
        {data.legal_notices.length > 0 ? (
          <View style={[s.row, { marginTop: 4 }]}>
            <View style={{ flex: 1, paddingRight: 6 }}>
              {data.legal_notices.map((n, i) => (
                <Text key={i} style={[s.notice, n.bold ? { fontWeight: 700 } : {}]}>
                  {n.en}
                </Text>
              ))}
            </View>
            <View style={{ flex: 1, paddingLeft: 6, borderLeftWidth: 0.5, borderLeftColor: LINE }}>
              {data.legal_notices.map((n, i) => (
                <Text key={i} style={[s.notice, n.bold ? { fontWeight: 700 } : {}]}>
                  {n.es}
                </Text>
              ))}
            </View>
          </View>
        ) : null}

        {/* Default date · signature · thumb print */}
        <View style={[s.row, { marginTop: 4 }]}>
          <View style={[s.box, { width: 150, padding: 4 }]}>
            <Text style={{ fontSize: 8, fontWeight: 700 }}>{en.defaultDate}:</Text>
            <Text style={s.small}>{es.defaultDate}</Text>
            <Text style={{ fontSize: 10, fontWeight: 700, marginTop: 1 }}>{mdy(data.default_date)}</Text>
            <Text style={[s.small, { marginTop: 4 }]}>{bl(en.amountAtDefault, es.amountAtDefault)}</Text>
            <Text style={{ fontSize: 10, fontWeight: 700, fontFamily: 'JetBrains Mono', marginTop: 1 }}>
              {money(data.amount_at_default)}
            </Text>
          </View>
          <View style={{ flex: 1, paddingHorizontal: 8, justifyContent: 'flex-end' }}>
            <View style={[s.row, { alignItems: 'flex-end' }]}>
              <View style={{ width: 92, marginRight: 10 }}>
                <View style={s.sigLine}>
                  <Text style={s.small}>{bl(en.employee, es.employee)}</Text>
                </View>
              </View>
              <View style={{ flex: 1 }}>
                {data.signatureImage ? (
                  // eslint-disable-next-line jsx-a11y/alt-text
                  <Image src={data.signatureImage} style={{ height: 28, objectFit: 'contain', objectPosition: 'left' }} />
                ) : (
                  <View style={{ height: 28 }} />
                )}
                <View style={s.sigLine}>
                  <Text style={s.small}>{bl(en.signature, es.signature)}</Text>
                </View>
              </View>
            </View>
            <Text style={{ fontSize: 7, fontWeight: 700, textAlign: 'right', marginTop: 3 }}>
              {bl(en.seeReverse, es.seeReverse)}
            </Text>
          </View>
          <View style={{ alignItems: 'center' }}>
            <View style={s.thumb} />
            <Text style={[s.small, { marginTop: 2, width: 104, textAlign: 'center' }]}>{bl(en.thumbPrint, es.thumbPrint)}</Text>
          </View>
        </View>
      </View>
    </Page>
  )
}
