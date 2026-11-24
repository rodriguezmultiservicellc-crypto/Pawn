/**
 * The front of the pawn ticket: the pawnbroker transaction form.
 *
 * Laid out after the form the shop's customers already know (the Florida
 * Pawnbroker Transaction Form): control number and barcode on top, the
 * pledgor block, one block per pledged item, the Truth in Lending boxes, the
 * default date, the pledgor's statement, signature and thumb print.
 *
 * Rules
 *   - One language per sheet. The legal ticket (customer and store copies)
 *     is English only: Fla. Stat. 539.001(8)(a) — the form "must be typed or
 *     written indelibly and legibly in English". The Spanish sheet is a
 *     courtesy translation ('courtesy' copy), stamped across as not legally
 *     valid (CourtesyStamp).
 *   - No statutory wording lives here. The statements printed above the
 *     signature are the jurisdiction's own notices (rule 18), in the sheet's
 *     language.
 *   - Every figure is handed in by render-loan-ticket (figured with the same
 *     loan math the app charges with). Nothing is computed in this file.
 *   - One sheet per copy ("Customer copy" / "Store copy"). The lending boxes
 *     and the signature stay together at the foot; a ticket with more items
 *     than fit above them flows onto a second sheet rather than shrinking
 *     the type.
 */

import { Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import { reportColors } from '@/lib/tokens'
import { money } from '@/lib/pos/receipt-thermal'
import { itemIdentity } from '@/lib/pawn/item-identity'
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
  // truth in lending — the term on top, then its explanation beside the
  // figure: the foot stays short so the front holds more items.
  footBand: { backgroundColor: INK, color: '#ffffff', fontSize: 7.5, fontWeight: 700, textAlign: 'center', paddingVertical: 1.5 },
  tilCell: { flex: 1, paddingHorizontal: 3.5, paddingTop: 2, paddingBottom: 2.5, borderRightWidth: 0.5, borderRightColor: LINE },
  tilHead: { fontSize: 6.6, fontWeight: 700 },
  // The cells stretch to the tallest one; each explanation starts at the top
  // and each figure sits at the bottom right, so all five figures share one line.
  tilBody: { flexGrow: 1, flexDirection: 'row', alignItems: 'flex-end', marginTop: 1 },
  tilSub: { flex: 1, alignSelf: 'flex-start', fontSize: 4.9, lineHeight: 1.15, color: SOFT, paddingRight: 3 },
  tilValue: { flexShrink: 0, fontSize: 10.5, fontWeight: 700, fontFamily: 'JetBrains Mono' },
  // statements + signature
  notice: { fontSize: 6, lineHeight: 1.12, marginBottom: 1.2 },
  sigLine: { borderTopWidth: 0.8, borderTopColor: LINE, marginTop: 2, paddingTop: 1.5 },
  thumb: { width: 100, height: 52, borderWidth: 0.8, borderColor: LINE, justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 1.5 },
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
  L,
  kind,
  metal,
  barrelLength,
}: {
  item: PawnTicketCollateral
  no: number
  /** The labels, in the sheet's language. */
  L: FormLabels
  /** What the piece is (a firearm: its kind). */
  kind: string
  /** The metal in words ("Gold"); '' when none. */
  metal: string
  /** "Barrel length". */
  barrelLength: string
}) {
  const { serial, brand, model } = itemIdentity(item)
  const genderKey = item.jewelry_gender as keyof FormLabels['genders'] | null
  const gender =
    genderKey && L.genders[genderKey] ? L.genders[genderKey] : ''
  const brandModel = [brand, model].filter(Boolean).join(' ')
  const firearm = Boolean(item.firearm_type || item.firearm_caliber || item.firearm_serial_number)
  return (
    <View wrap={false} style={{ borderBottomWidth: 0.8, borderBottomColor: LINE, flexDirection: 'row' }}>
      <View style={{ width: 24, alignItems: 'center', paddingTop: 2, borderRightWidth: 0.5, borderRightColor: LINE }}>
        <Text style={s.label}>{L.itemNo}</Text>
        <Text style={{ fontSize: 11, fontWeight: 700, marginTop: 5 }}>{no}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={s.rowLine}>
          <Cell label={L.itemType} value={kind} flex={1.9} />
          <Cell label={L.description} value={item.description} flex={4.6} />
          <Cell label={L.serialNo} value={serial} flex={1.6} mono />
          <Cell label={`${L.brand} · ${L.model}`} value={brandModel} flex={1.7} />
          <Cell label={L.amount} value={money(item.est_value)} flex={1.2} mono last />
        </View>
        <View style={firearm ? s.rowLine : s.row}>
          <Cell label={L.metal} value={metal} flex={1.4} />
          <Cell label={L.karat} value={item.karat ? `${Number(item.karat.toFixed(1))}` : ''} flex={0.9} mono />
          <Cell label={L.weight} value={item.weight_grams ? `${Number(item.weight_grams.toFixed(2))} g` : ''} flex={1} mono />
          <Cell label={L.size} value={txt(item.jewelry_size) || txt(item.item_size)} flex={0.8} />
          <Cell label={L.style} value={txt(item.jewelry_style)} flex={1.3} />
          <Cell label={L.gender} value={gender} flex={1.7} />
          <Cell label={L.color} value={txt(item.color)} flex={1.2} />
          <Cell label={L.stones} value={txt(item.gemstone_description)} flex={2.5} />
          <Cell label={L.marks} value={txt(item.unique_marks)} flex={1.6} last />
        </View>
        {firearm ? (
          <View style={s.row}>
            <Cell label={L.action} value={txt(item.firearm_action_type)} flex={2} />
            <Cell label={L.caliber} value={txt(item.firearm_caliber)} flex={1.5} />
            <Cell label={L.finish} value={txt(item.firearm_finish)} flex={1.5} />
            <Cell label={L.barrels} value={txt(item.firearm_number_of_barrels)} flex={1} />
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

// ── Fitting the sheet ────────────────────────────────────────────────────
//
// Fla. Stat. § 539.001(8)(b): "The front of the pawnbroker transaction form
// must include" the amount financed, the finance charge, the maturity and
// default dates and the statements — the foot of this sheet. The foot used
// to be pushed to a second page whenever the items ran long, leaving the
// front without it. Now the front keeps the foot and as many items as fit;
// the rest go to a continuation sheet.
//
// React-PDF only knows heights after it has laid the page out, so the split
// is worked out here from the text, a little on the high side: an item sent
// to the continuation sheet one too early costs nothing, the foot pushed off
// the front is the thing to avoid.

const PAGE_CONTENT_HEIGHT = 792 - 40 // LETTER minus s.page's vertical padding
const CONTENT_WIDTH = 612 - 56
const ITEM_WIDTH = CONTENT_WIDTH - 24 // the "Item No." column
const VALUE_LINE = 11 // s.value: 8.6pt
const LABEL_LINE = 6.6 // s.label: 5.2pt
const CELL_PAD = 4.5 // s.cell: paddingTop + value marginTop + paddingBottom
const VALUE_CHAR = 4.3 // average width of a character at 8.6pt
const MONO_CHAR = 5.2

/** How many lines `text` takes in a cell `maxChars` wide, breaking at spaces. */
export function wrapLines(text: string, maxChars: number): number {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return 1
  const max = Math.max(1, Math.floor(maxChars))
  let lines = 1
  let used = 0
  for (const w of words) {
    const len = w.length
    if (used === 0) {
      lines += Math.ceil(len / max) - 1
      used = len % max || max
    } else if (used + 1 + len <= max) {
      used += 1 + len
    } else {
      lines += Math.ceil(len / max)
      used = len % max || max
    }
  }
  return lines
}

function cellHeight(value: string, flex: number, total: number, labelLines: number, mono = false): number {
  const width = (ITEM_WIDTH * flex) / total - 6.5
  const lines = wrapLines(value, width / (mono ? MONO_CHAR : VALUE_CHAR))
  return Math.max(21, CELL_PAD + labelLines * LABEL_LINE + lines * VALUE_LINE)
}

/** Points of height one item takes on the sheet. Mirrors ItemBlock's cells. */
export function estimateItemHeight(item: PawnTicketCollateral, kind: string, metal: string): number {
  const t = (v: string | number | null | undefined) => (v == null ? '' : String(v))
  const { serial, brand, model } = itemIdentity(item)
  const row1 = Math.max(
    cellHeight(kind, 1.9, 11, 1),
    cellHeight(item.description, 4.6, 11, 1),
    cellHeight(serial, 1.6, 11, 1, true),
    cellHeight([brand, model].filter(Boolean).join(' '), 1.7, 11, 2), // its label always wraps
    cellHeight('', 1.2, 11, 1),
  )
  const row2 = Math.max(
    cellHeight(metal, 1.4, 12.4, 1),
    cellHeight('', 0.9, 12.4, 2), // "Karat / Quilates" wraps
    cellHeight(t(item.jewelry_size) || t(item.item_size), 0.8, 12.4, 1),
    cellHeight(t(item.jewelry_style), 1.3, 12.4, 1),
    cellHeight('Women / Mujer', 1.7, 12.4, 1),
    cellHeight(t(item.color), 1.2, 12.4, 1),
    cellHeight(t(item.gemstone_description), 2.5, 12.4, 1),
    cellHeight(t(item.unique_marks), 1.6, 12.4, 1),
  )
  const firearm = Boolean(item.firearm_type || item.firearm_caliber || item.firearm_serial_number)
  return row1 + row2 + (firearm ? 34 : 0) + 1.6
}

/** Height of the statements at the foot: one full-width column
 *  (s.notice: 6pt × 1.12, about 160 characters a line). */
function noticesHeight(texts: ReadonlyArray<string>): number {
  return texts.reduce((sum, text) => sum + wrapLines(text, 160) * 6.9 + 1.4, 0)
}

/** The foot without its statements: lending boxes, default date,
 *  signature, thumb print (measured ~134pt on a rendered ticket). */
const FOOT_BASE = 150

/**
 * How many of the items go on the front sheet. Always at least one; all of
 * them when they fit beside the foot.
 */
export function itemsOnFront(args: {
  itemHeights: ReadonlyArray<number>
  /** Lines the residence and the place of employment take beyond one each. */
  extraPledgorLines: number
  /** The statements printed at the foot, in the sheet's language. */
  notices: ReadonlyArray<string>
}): number {
  const top = 262 + args.extraPledgorLines * VALUE_LINE // header + pledgor + the goods band
  const foot = FOOT_BASE + noticesHeight(args.notices)
  const room = PAGE_CONTENT_HEIGHT - top - foot - 10
  let used = 0
  let n = 0
  for (const h of args.itemHeights) {
    if (n > 0 && used + h > room) break
    used += h
    n += 1
  }
  return Math.min(args.itemHeights.length, Math.max(1, n))
}

/** The language a sheet prints in. English is the legal ticket (FL
 *  539.001(8)(a): "in English"); Spanish is a stamped courtesy copy. */
export type TicketLang = 'en' | 'es'

/** The statements printed at the foot, in the sheet's language. */
function noticesOf(data: PawnTicketData, lang: TicketLang): string[] {
  return data.legal_notices.length > 0
    ? data.legal_notices.map((n) => n[lang])
    : [data.i18n[lang].pawn.print.legal.placeholder]
}

/** The item words both sheets need, and where the items split. */
function formParts(data: PawnTicketData, lang: TicketLang) {
  const L: FormLabels = data.i18n[lang].pawn.print.form
  const nw = data.i18n[lang].pawn.new_
  const inv: InventoryWords = data.i18n[lang].inventory

  const firearmKind = (v: string | null): string | null =>
    v === 'handgun'
      ? nw.itemFirearmTypeHandgun
      : v === 'rifle'
        ? nw.itemFirearmTypeRifle
        : v === 'shotgun'
          ? nw.itemFirearmTypeShotgun
          : v === 'other'
            ? nw.itemFirearmTypeOther
            : null
  const kindOf = (item: PawnTicketCollateral): string => {
    const key = item.category as keyof FormLabels['categories']
    return firearmKind(item.firearm_type) ?? L.categories[key] ?? item.category
  }
  // gold -> metalGold, white_gold -> metalWhiteGold: the inventory's own words.
  const metalWords = (m: string | null): string => {
    if (!m || m === 'none') return ''
    const key = `metal${m
      .split('_')
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join('')}` as keyof InventoryWords
    const word = inv[key]
    return typeof word === 'string' ? word : m.replace(/_/g, ' ')
  }

  const c = data.customer
  const residence = [c.address1, c.address2, c.city, [c.state, c.zip].filter(Boolean).join(' ')]
    .filter((p) => p && String(p).trim())
    .join(', ')
  const pledgorChars = ((CONTENT_WIDTH * 6) / 8 - 6.5) / VALUE_CHAR
  const frontCount = itemsOnFront({
    itemHeights: data.collateral.map((item) =>
      estimateItemHeight(item, kindOf(item), metalWords(item.metal_type)),
    ),
    extraPledgorLines:
      wrapLines(residence, pledgorChars) - 1 + (wrapLines(c.place_of_employment ?? '', pledgorChars) - 1),
    notices: noticesOf(data, lang),
  })
  return {
    L,
    kindOf,
    metalWords,
    residence,
    frontCount,
    barrelLength: nw.itemFirearmBarrelLength,
  }
}

/**
 * Which sheet this is. 'courtesy' is the Spanish translation: same form,
 * stamped as not legally valid, never signed as the contract.
 */
export type TicketCopy = 'customer' | 'store' | 'courtesy'

/** The copy's name on a sheet ("Customer copy"). */
function copyLabel(copy: TicketCopy, L: FormLabels): string {
  return copy === 'store' ? L.storeCopy : copy === 'courtesy' ? L.courtesyCopy : L.customerCopy
}

/** The language a copy prints in. */
const langOf = (copy: TicketCopy): TicketLang => (copy === 'courtesy' ? 'es' : 'en')

/**
 * Across every courtesy sheet: a large diagonal stamp, in Spanish and in
 * English so whoever holds the paper can read it, plus a line on top
 * saying the English ticket is the legal one.
 */
function CourtesyStamp({ data }: { data: PawnTicketData }) {
  const es = data.i18n.es.pawn.print.form
  const en = data.i18n.en.pawn.print.form
  return (
    <>
      <View
        fixed
        style={{ position: 'absolute', top: 300, left: -60, right: -60, alignItems: 'center', transform: 'rotate(-32deg)' }}
      >
        <Text style={{ fontSize: 54, fontWeight: 700, color: '#c62828', opacity: 0.22, letterSpacing: 2 }}>
          {es.notLegalStamp}
        </Text>
        <Text style={{ fontSize: 30, fontWeight: 700, color: '#c62828', opacity: 0.22, letterSpacing: 2, marginTop: 4 }}>
          {en.notLegalStamp}
        </Text>
      </View>
      <Text
        fixed
        style={{ position: 'absolute', top: 6, left: 28, right: 28, fontSize: 7, fontWeight: 700, color: '#c62828', textAlign: 'center' }}
      >
        {es.courtesyNotice} / {en.courtesyNotice}
      </Text>
    </>
  )
}

export function TransactionFormPage({ data, copy }: { data: PawnTicketData; copy: TicketCopy }) {
  const lang = langOf(copy)
  const { L, kindOf, metalWords, residence, frontCount, barrelLength } = formParts(data, lang)
  const frontItems = data.collateral.slice(0, frontCount)
  const total = data.collateral.length

  const t = data.tenant
  const c = data.customer
  const shop = t.dba?.trim() || t.name
  const cityLine = [t.city, [t.state, t.zip].filter(Boolean).join(' ')].filter((p) => p && p.trim()).join(', ')
  const closed = data.status === 'redeemed' || data.status === 'forfeited' || data.status === 'voided'
  const closedKey = data.status as 'redeemed' | 'forfeited' | 'voided'
  const idKey = c.id_type as keyof FormLabels['idTypes'] | null

  return (
    <Page size="LETTER" style={s.page} wrap>
      {/* ── Header: form title + shop · barcode + date · control number */}
      <View style={[s.row, { justifyContent: 'space-between', alignItems: 'flex-start' }]} wrap={false}>
        <View style={{ flex: 1, paddingRight: 8 }}>
          <Text style={s.title}>
            {[data.jurisdiction_name?.toUpperCase(), L.title.toUpperCase()].filter(Boolean).join(' ')}
          </Text>
          <Text style={[s.small, { marginTop: 3 }]}>{L.pawnbroker}:</Text>
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
                <Text style={{ fontSize: 7.5 }}>{L.transactionDate}</Text>
              </View>
              <Text style={{ fontSize: 9.5, fontWeight: 700 }}>{mdy(data.issue_date)}</Text>
            </View>
            <View style={[s.row, { justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }]}>
              <Text style={{ fontSize: 7.5, flex: 1 }}>{L.time}</Text>
              <Text style={{ fontSize: 9.5, fontWeight: 700 }}>{data.transaction_time}</Text>
            </View>
          </View>
        </View>
        <View style={{ width: 178, alignItems: 'flex-end' }}>
          <View style={[s.row, { alignItems: 'center' }]}>
            <View style={{ marginRight: 6, alignItems: 'flex-end' }}>
              <Text style={{ fontSize: 8 }}>{L.controlNo}</Text>
            </View>
            <View style={s.controlBox}>
              <Text style={s.controlNo}>{data.ticket_number}</Text>
            </View>
          </View>
          <Text style={s.copy}>{copyLabel(copy, L)}</Text>
          {closed ? (
            <Text style={{ fontSize: 8, fontWeight: 700, marginTop: 1 }}>
              {L.status[closedKey].toUpperCase()}
            </Text>
          ) : null}
          <View style={[s.row, { marginTop: 5, alignItems: 'center' }]}>
            <View style={{ marginRight: 8, alignItems: 'flex-end' }}>
              <Text style={{ fontSize: 8 }}>{L.maturityDate}</Text>
            </View>
            <Text style={{ fontSize: 10.5, fontWeight: 700 }}>{mdy(data.due_date)}</Text>
          </View>
        </View>
      </View>

      <View style={[s.row, { justifyContent: 'flex-end', alignItems: 'center', marginTop: 4, marginBottom: 3 }]}>
        <Text style={{ fontSize: 8 }}>{L.typeOfTransaction}:</Text>
        <Check on={false} label={L.typePurchase} />
        <Check on={false} label={L.typeConsignment} />
        <Check on label={L.typePawn} />
      </View>

      {/* ── Pledgor / seller */}
      <View style={s.box} wrap={false}>
        <Text style={s.band}>{L.pledgor.toUpperCase()}</Text>
        <View style={s.rowLine}>
          <Cell label={L.lastName} value={c.last_name} flex={2.2} />
          <Cell label={L.firstName} value={c.first_name} flex={2.2} />
          <Cell label={L.middleName} value={txt(c.middle_name)} flex={1.6} />
          <Cell label={L.dob} value={mdy(c.date_of_birth)} flex={1.5} mono />
          <Cell label={L.sex} value={txt(c.sex)} flex={0.7} />
          <Cell label={L.race} value={txt(c.race)} flex={1.3} last />
        </View>
        <View style={s.rowLine}>
          <Cell label={L.residence} value={residence} flex={6} />
          <Cell label={L.homePhone} value={txt(c.phone)} flex={2} mono last />
        </View>
        <View style={s.rowLine}>
          <Cell label={L.employment} value={txt(c.place_of_employment)} flex={6} />
          <Cell label={L.businessPhone} value={txt(c.phone_alt)} flex={2} mono last />
        </View>
        <View style={s.row}>
          <Cell label={L.idNumber} value={txt(c.id_number)} flex={2.6} mono />
          <Cell
            label={L.idType}
            value={idKey ? (L.idTypes[idKey] ?? idKey) : ''}
            flex={1.5}
          />
          <Cell label={L.idState} value={txt(c.id_state)} flex={1} />
          <Cell label={L.height} value={feetInches(c.height_inches)} flex={0.9} mono />
          <Cell label={L.weightLbs} value={c.weight_lbs ? String(c.weight_lbs) : ''} flex={0.9} mono />
          <Cell label={L.eyes} value={txt(c.eye_color)} flex={1} />
          <Cell label={L.hair} value={txt(c.hair_color)} flex={1} />
          <Cell label={L.identifyingMarks} value={txt(c.identifying_marks)} flex={2.4} last />
        </View>
      </View>

      {/* ── Pledged goods */}
      <View style={[s.box, { marginTop: 4, borderBottomWidth: 0 }]}>
        <Text style={s.band}>{L.securityInterest}</Text>
        {frontItems.map((item, i) => (
          <ItemBlock
            key={i}
            item={item}
            no={i + 1}
            L={L}
            kind={kindOf(item)}
            metal={metalWords(item.metal_type)}
            barrelLength={barrelLength}
          />
        ))}
        {total === 0 ? (
          <Text style={{ padding: 8, fontSize: 8, borderBottomWidth: 0.8, borderBottomColor: LINE }}>—</Text>
        ) : null}
        {/* More items than the front holds: say so, on the front. */}
        {total > frontCount ? (
          <Text
            style={{
              fontSize: 7.5,
              fontWeight: 700,
              textAlign: 'center',
              paddingVertical: 2.5,
              borderBottomWidth: 0.8,
              borderBottomColor: LINE,
            }}
          >
            {L.itemsContinue.replace('{from}', String(frontCount + 1)).replace('{to}', String(total))}
          </Text>
        ) : null}
      </View>

      {/* ── The foot of the sheet: lending boxes, statements, signature.
            One unbreakable block pinned to the bottom margin. */}
      <View style={{ marginTop: 'auto', paddingTop: 5 }} wrap={false}>
        <View style={s.box}>
          <Text style={s.footBand}>{L.truthInLending.toUpperCase()}</Text>
          <View style={s.row}>
            {(
              [
                [L.amountFinanced, L.amountFinancedHelp, money(data.principal)],
                [L.financeCharge, L.financeChargeHelp, money(data.total_interest_at_term)],
                [L.totalOfPayments, L.totalOfPaymentsHelp, money(data.total_payoff_at_term)],
                [L.apr, L.aprHelp, `${(data.apr * 100).toFixed(2)}%`],
                [L.maturityDate, '', mdy(data.due_date)],
              ] as const
            ).map(([head, sub, value], i, all) => (
              <View key={i} style={[s.tilCell, i === all.length - 1 ? { borderRightWidth: 0 } : {}]}>
                <Text style={s.tilHead}>{head.toUpperCase()}</Text>
                <View style={s.tilBody}>
                  <Text style={s.tilSub}>{sub}</Text>
                  <Text style={s.tilValue}>{value}</Text>
                </View>
              </View>
            ))}
          </View>
          <View style={[s.row, { borderTopWidth: 0.5, borderTopColor: LINE }]}>
            <Text style={{ flex: 1, fontSize: 5.4, lineHeight: 1.15, paddingHorizontal: 2.5, paddingVertical: 1.5 }}>
              {L.seeContract}
            </Text>
            <Text style={{ flex: 1, fontSize: 5.4, lineHeight: 1.15, paddingHorizontal: 2.5, paddingVertical: 1.5, textAlign: 'right' }}>
              {L.paymentSchedule}
            </Text>
          </View>
        </View>

        {/* The jurisdiction's statements, in the sheet's language, one
            full-width column. A shop with no jurisdiction on file prints the
            placeholder instead, so the missing legal text is impossible to
            overlook. */}
        <View style={{ marginTop: 4 }}>
          {data.legal_notices.length === 0 ? (
            <Text style={s.notice}>{data.i18n[lang].pawn.print.legal.placeholder}</Text>
          ) : (
            data.legal_notices.map((n, i) => (
              <Text key={i} style={[s.notice, n.bold ? { fontWeight: 700 } : {}]}>
                {n[lang]}
              </Text>
            ))
          )}
        </View>

        {/* Default date · signature · thumb print. The default date and the
            amount to redeem on it sit side by side. */}
        <View style={[s.row, { marginTop: 3, alignItems: 'flex-end' }]}>
          <View style={[s.box, s.row, { width: 236 }]}>
            <View style={{ width: 92, padding: 3, borderRightWidth: 0.5, borderRightColor: LINE }}>
              <Text style={{ fontSize: 7, fontWeight: 700 }}>{L.defaultDate}:</Text>
              <Text style={{ fontSize: 10, fontWeight: 700, marginTop: 1 }}>{mdy(data.default_date)}</Text>
            </View>
            <View style={{ flex: 1, padding: 3 }}>
              <Text style={[s.small, { lineHeight: 1.1 }]}>{L.amountAtDefault}</Text>
              <Text style={{ fontSize: 10, fontWeight: 700, fontFamily: 'JetBrains Mono', marginTop: 1 }}>
                {money(data.amount_at_default)}
              </Text>
            </View>
          </View>
          <View style={{ flex: 1, paddingHorizontal: 8, justifyContent: 'flex-end' }}>
            <View style={[s.row, { alignItems: 'flex-end' }]}>
              <View style={{ width: 92, marginRight: 10 }}>
                <View style={s.sigLine}>
                  <Text style={s.small}>{L.employee}</Text>
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
                  <Text style={s.small}>{L.signature}</Text>
                </View>
              </View>
            </View>
            {/* The courtesy copy has no reverse: the terms are English only. */}
            {copy === 'courtesy' ? null : (
              <Text style={{ fontSize: 7, fontWeight: 700, textAlign: 'right', marginTop: 3 }}>
                {L.seeReverse}
              </Text>
            )}
          </View>
          <View style={s.thumb}>
            <Text style={[s.small, { fontSize: 4.8, textAlign: 'center' }]}>{L.thumbPrint}</Text>
          </View>
        </View>
      </View>
      {/* Drawn last so it lies over the form. */}
      {copy === 'courtesy' ? <CourtesyStamp data={data} /> : null}
    </Page>
  )
}

/**
 * The items that did not fit on the front, on their own sheet(s). Renders
 * nothing when the front holds them all.
 */
export function TransactionFormContinuation({
  data,
  copy,
}: {
  data: PawnTicketData
  copy: TicketCopy
}) {
  const { L, kindOf, metalWords, frontCount, barrelLength } = formParts(data, langOf(copy))
  const rest = data.collateral.slice(frontCount)
  if (rest.length === 0) return null
  const shop = data.tenant.dba?.trim() || data.tenant.name

  return (
    <Page size="LETTER" style={s.page} wrap>
      <View
        style={[s.row, { justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }]}
        wrap={false}
        fixed
      >
        <View style={{ flex: 1, paddingRight: 8 }}>
          <Text style={s.title}>
            {[data.jurisdiction_name?.toUpperCase(), L.title.toUpperCase()].filter(Boolean).join(' ')}
          </Text>
          <Text style={s.shop}>{shop}</Text>
          <Text style={{ fontSize: 9, fontWeight: 700, marginTop: 3 }}>
            {L.continuation}
          </Text>
        </View>
        <View style={{ width: 250, alignItems: 'flex-end' }}>
          <View style={[s.row, { alignItems: 'center' }]}>
            <View style={{ marginRight: 6, alignItems: 'flex-end' }}>
              <Text style={{ fontSize: 8 }}>{L.controlNo}</Text>
            </View>
            <View style={s.controlBox}>
              <Text style={s.controlNo}>{data.ticket_number}</Text>
            </View>
          </View>
          <Text style={s.copy}>{copyLabel(copy, L)}</Text>
          <Text style={{ fontSize: 8, marginTop: 2 }}>
            {L.transactionDate}: {mdy(data.issue_date)}
          </Text>
        </View>
      </View>

      <View style={[s.box, { borderBottomWidth: 0 }]}>
        <Text style={s.band}>{L.securityInterest}</Text>
        {rest.map((item, i) => (
          <ItemBlock
            key={i}
            item={item}
            no={frontCount + i + 1}
            L={L}
            kind={kindOf(item)}
            metal={metalWords(item.metal_type)}
            barrelLength={barrelLength}
          />
        ))}
      </View>
      {copy === 'courtesy' ? <CourtesyStamp data={data} /> : null}
    </Page>
  )
}
