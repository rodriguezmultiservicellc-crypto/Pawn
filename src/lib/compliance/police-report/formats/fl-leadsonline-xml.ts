/**
 * The LeadsOnline upload file — XML, tag for tag the format xPawn has sent
 * LeadsOnline for Eddy's Jewelers since 2025 (182 files in
 * Dropbox\pawn police, each one accepted). Rule 15: built from compliance_log
 * rows only.
 *
 * What the accepted files show, and this file copies:
 *   - <LeadsOnlineUpload> → software → store_info → tickets/ticket → customer
 *     → property/item, every element in that order, empty ones written
 *     <x></x> (redeem_date, ticket_number_orig, enter_date_orig self-closed).
 *     Tab indentation, CRLF line ends.
 *   - ticket_type 2 = pawn, 1 = buy. void Y/N: a voided ticket is SENT with
 *     Y (never held back); one voided after it went out is sent again with Y.
 *   - Dates YYYY-MM-DDThh:mm:ss in the shop's time; birthdate at T00:00:00.
 *   - Height 5'07"; phone 10 digits; amounts whole dollars; weight grams.
 *   - Four empty cust_picture placeholders (C, I, T, S) and one item_picture
 *     (A): xPawn never sent images.
 *   - item_category 1 = jewelry (301 of 302 items), 0 = other.
 *
 * NOT confirmed with LeadsOnline (no file of ours has been sent): codes for
 * non-jewelry categories, a buy's ticket number (Pawn has none; the first
 * item's SKU is sent), ID types other than DL.
 */

import { purityScaleOf } from '@/lib/spot-prices/purity'
import type { ComplianceLogRow } from '@/types/database-aliases'
import { itemIdentity } from '@/lib/pawn/item-identity'
import { normalizeStones } from '@/lib/pawn/stones'

export type LeadsOnlineStore = {
  company: string
  storeNumber: string
  address1: string
  address2: string
  city: string
  state: string
  zip: string
  county: string
  phone: string
}

/** One ticket in the file: the intake row (pawn_intake | buy_outright) and
 *  whether it goes out voided. */
export type LeadsOnlineTicket = { row: ComplianceLogRow; voided: boolean }

type Obj = Record<string, unknown>

const s = (v: unknown): string =>
  v == null ? '' : typeof v === 'string' ? v.trim() : typeof v === 'number' || typeof v === 'boolean' ? String(v) : ''

const digits = (v: unknown) => s(v).replace(/\D/g, '')

/** Element text: & < > only. Quotes stay as typed (5'07"), as in the
 *  accepted files; the only attributes written are fixed codes. */
const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** "(813) 876-3119" — the store phone as xPawn wrote it. */
function storePhone(v: string): string {
  const d = v.replace(/\D/g, '')
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : v
}

/** A UTC instant as the shop's wall clock: 2026-11-17T16:34:00. */
export function shopDateTime(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso))
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? '00'
  return `${p('year')}-${p('month')}-${p('day')}T${p('hour')}:${p('minute')}:${p('second')}`
}

/** 67 → 5'07" */
export function heightText(inches: unknown): string {
  const n = typeof inches === 'number' ? inches : parseInt(s(inches), 10)
  if (!isFinite(n) || n <= 0) return ''
  return `${Math.floor(n / 12)}'${String(n % 12).padStart(2, '0')}"`
}

/** Pawn's ID types in the words the accepted files used. */
export function idTypeText(v: unknown): string {
  switch (s(v)) {
    case 'drivers_license': return 'DL'
    case 'state_id': return 'ID'
    case 'passport': return 'Passport'
    case 'military_id': return 'Military ID'
    case 'permanent_resident_card': return 'Permanent Resident Card'
    default: return ''
  }
}

const JEWELRY_CATEGORIES = new Set(['ring', 'necklace', 'bracelet', 'earrings', 'pendant', 'chain', 'watch', 'loose_stone', 'jewelry'])

function isJewelry(it: Obj): boolean {
  return s(it.pawn_category_slug) === 'jewelry' || JEWELRY_CATEGORIES.has(s(it.category))
}

/** "Yellow Gold", "White Gold", "Two Tone", "Silver" — the metal as the
 *  accepted files named it, from Pawn's metal + color. */
export function metalText(metal: unknown, color: unknown): string {
  const m = s(metal)
  const c = s(color).toLowerCase()
  if (!m || m === 'none') return ''
  if (m === 'white_gold') return 'White Gold'
  if (m === 'rose_gold') return 'Rose Gold'
  if (m === 'gold') {
    if (c === 'yellow' || c === 'white' || c === 'rose') return `${c[0].toUpperCase()}${c.slice(1)} Gold`
    if (c === 'two-tone' || c === 'two tone' || c === 'two_tone') return 'Two Tone'
    if (c === 'tri-color' || c === 'tri color' || c === 'tri_color') return 'Tri-Color'
    return 'Gold'
  }
  return m
    .split('_')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
}

const GENDER: Record<string, string> = { men: 'M', women: 'F', unisex: 'N' }

/** Whole dollars, as every accepted file carried them. */
const dollars = (v: unknown) => {
  const n = typeof v === 'number' ? v : parseFloat(s(v))
  return isFinite(n) ? String(Math.round(n)) : ''
}

const grams = (v: unknown) => {
  const n = typeof v === 'number' ? v : parseFloat(s(v))
  return isFinite(n) && n > 0 ? String(Number(n.toFixed(2))) : ''
}

/** The ticket number as the agency knows it: digits for a pawn ("PT-015665"
 *  → "15665", continuing xPawn's count) and for a buy numbered BT-######
 *  (patches/0115, continuing xPawn's buy count); an older buy's SKU as is. */
export function ticketNumberText(row: Pick<ComplianceLogRow, 'reference_number' | 'event_type'>): string {
  const ref = s(row.reference_number)
  if (
    row.event_type === 'pawn_intake' ||
    row.event_type === 'pawn_void' ||
    (row.event_type === 'buy_outright' && /^BT-\d+$/.test(ref))
  ) {
    const d = ref.replace(/\D/g, '').replace(/^0+(?=\d)/, '')
    return d || ref
  }
  return ref
}

class Out {
  private lines: string[] = []
  open(tag: string, depth: number) { this.lines.push(`${'\t'.repeat(depth)}<${tag}>`) }
  close(tag: string, depth: number) { this.lines.push(`${'\t'.repeat(depth)}</${tag}>`) }
  el(tag: string, value: string, depth: number) { this.lines.push(`${'\t'.repeat(depth)}<${tag}>${esc(value)}</${tag}>`) }
  empty(tag: string, depth: number) { this.lines.push(`${'\t'.repeat(depth)}<${tag}/>`) }
  raw(line: string, depth: number) { this.lines.push(`${'\t'.repeat(depth)}${line}`) }
  text() { return this.lines.join('\r\n') + '\r\n' }
}

function writeItem(o: Out, it: Obj, index: number, ncic: string, amountKey: 'est_value' | 'payout') {
  const d = 5
  const id = itemIdentity(it)
  const jewelry = isJewelry(it)
  const stones = normalizeStones(it.stones)
  o.open('item', 4)
  o.el('item_number', String(index + 1), d)
  o.el('item_qty', '1', d)
  o.el('item_make', id.brand || s(it.brand), d)
  o.el('item_model', id.model || s(it.model), d)
  o.el('item_serial', id.serial || s(it.serial_number), d)
  o.el('item_oan', '', d)
  o.el('item_color', jewelry ? '' : s(it.color), d)
  o.el('item_condition', '', d)
  o.el('item_desc', s(it.description), d)
  o.el('item_notes', s(it.unique_marks), d)
  o.el('item_category', jewelry ? '1' : '0', d)
  o.el('item_ncic', ncic, d)
  o.el('item_amount', dollars(it[amountKey]), d)
  o.raw('<item_picture code="A"/>', d)
  o.el('jewelry_style', jewelry ? s(it.jewelry_style) : '', d)
  o.el('jewelry_metal', jewelry ? metalText(it.metal_type, it.color) : '', d)
  // Karats only: xPawn's accepted files send jewelry_kt for gold alone. A
  // silver or platinum purity (925, 950) is in item_desc, never sent as a
  // karat of 925.
  o.el('jewelry_kt', jewelry && purityScaleOf(s(it.metal_type)) === 'karat' ? digits(it.karat) : '', d)
  o.el('jewelry_wt', jewelry ? grams(it.weight_grams) : '', d)
  o.el('jewelry_size', s(it.jewelry_size) || s(it.item_size), d)
  o.el('jewelry_sex', jewelry ? (GENDER[s(it.jewelry_gender)] ?? '') : '', d)
  o.el('jewelry_class_nm', '', d)
  o.el('jewelry_class_yr', '', d)
  for (const n of [1, 2] as const) {
    const st = stones[n - 1]
    o.el(`jewelry_stone${n}_type`, st?.type ?? '', d)
    o.el(`jewelry_stone${n}_color`, st?.color ?? '', d)
    o.el(`jewelry_stone${n}_qty`, st?.qty != null ? String(st.qty) : '', d)
    o.el(`jewelry_stone${n}_shape`, st?.cut ?? '', d)
    o.el(`jewelry_stone${n}_carat`, st?.carat != null ? String(st.carat) : '', d)
  }
  o.el('firearm_caliber', s(it.firearm_caliber), d)
  o.el('firearm_type', s(it.firearm_type), d)
  o.el('firearm_action', s(it.firearm_action_type), d)
  o.el('firearm_finish', s(it.firearm_finish), d)
  o.el('firearm_barrel', s(it.firearm_barrel_length_inches), d)
  o.close('item', 4)
}

export function buildLeadsOnlineXml(args: {
  store: LeadsOnlineStore
  tickets: ReadonlyArray<LeadsOnlineTicket>
  timeZone: string
  software: { name: string; version: string }
  ncicBySlug?: Record<string, string>
}): string {
  const { store, timeZone } = args
  const ncicBySlug = args.ncicBySlug ?? {}
  const o = new Out()
  o.raw('<?xml version="1.0" encoding="UTF-8"?>', 0)
  o.open('LeadsOnlineUpload', 0)
  o.open('software', 1)
  o.el('name', args.software.name, 2)
  o.el('version', args.software.version, 2)
  o.close('software', 1)
  o.open('store_info', 1)
  o.el('company_nm', store.company, 2)
  o.el('store_number', store.storeNumber, 2)
  o.el('store_nm', store.company, 2)
  o.el('store_addr1', store.address1, 2)
  o.el('store_addr2', store.address2, 2)
  o.el('store_city', store.city, 2)
  o.el('store_state', store.state, 2)
  o.el('store_zip', store.zip, 2)
  o.el('store_county', store.county, 2)
  o.el('store_phone', storePhone(store.phone), 2)
  o.close('store_info', 1)
  o.open('tickets', 1)

  for (const { row, voided } of args.tickets) {
    const c = (row.customer_snapshot ?? {}) as Obj
    const items = Array.isArray(row.items_snapshot) ? (row.items_snapshot as Obj[]) : []
    const buy = row.event_type === 'buy_outright'
    o.open('ticket', 2)
    o.el('ticket_type', buy ? '1' : '2', 3)
    o.el('ticket_number', ticketNumberText(row), 3)
    o.el('enter_date', shopDateTime(row.occurred_at, timeZone), 3)
    o.el('clerk', s(row.clerk), 3)
    o.el('void', voided ? 'Y' : 'N', 3)
    o.empty('redeem_date', 3)
    o.empty('ticket_number_orig', 3)
    o.empty('enter_date_orig', 3)

    o.open('customer', 3)
    const d = 4
    o.el('cust_nm_last', s(c.last_name), d)
    o.el('cust_nm_first', s(c.first_name), d)
    o.el('cust_nm_middle', s(c.middle_name), d)
    o.el('cust_nm_suffix', '', d)
    o.el('cust_addr1', s(c.address1), d)
    o.el('cust_addr2', s(c.address2), d)
    o.el('cust_city', s(c.city), d)
    o.el('cust_state', s(c.state).toUpperCase(), d)
    o.el('cust_zip', s(c.zip), d)
    o.el('cust_phone', digits(c.phone), d)
    o.el('cust_id_type', idTypeText(c.id_type), d)
    o.el('cust_id_state', s(c.id_state).toUpperCase(), d)
    o.el('cust_id_number', s(c.id_number), d)
    o.el('cust_id_exp', s(c.id_expiry) ? `${s(c.id_expiry).slice(0, 10)}T00:00:00` : '', d)
    o.el('cust_id_type2', '', d)
    o.el('cust_id_state2', '', d)
    o.el('cust_id_number2', '', d)
    o.el('cust_id_exp2', '', d)
    o.el('cust_birthdate', s(c.date_of_birth) ? `${s(c.date_of_birth).slice(0, 10)}T00:00:00` : '', d)
    o.el('cust_weight', s(c.weight_lbs), d)
    o.el('cust_height', heightText(c.height_inches), d)
    o.el('cust_eye', s(c.eye_color), d)
    o.el('cust_hair', s(c.hair_color), d)
    o.el('cust_race', s(c.race), d)
    o.el('cust_sex', s(c.sex).slice(0, 1).toUpperCase(), d)
    o.el('cust_info', s(c.identifying_marks), d)
    for (const code of ['C', 'I', 'T', 'S']) o.raw(`<cust_picture code="${code}"/>`, d)
    o.el('employer_nm', s(c.place_of_employment), d)
    for (const t of ['employer_addr1', 'employer_addr2', 'employer_city', 'employer_state', 'employer_zip', 'employer_phone']) {
      o.el(t, '', d)
    }
    o.close('customer', 3)

    o.open('property', 3)
    items.forEach((it, i) => {
      const ncic = ncicBySlug[s(it.pawn_subcategory_slug)] ?? ncicBySlug[s(it.pawn_category_slug)] ?? ''
      writeItem(o, it, i, ncic, buy ? 'payout' : 'est_value')
    })
    o.close('property', 3)
    o.close('ticket', 2)
  }

  o.close('tickets', 1)
  o.close('LeadsOnlineUpload', 0)
  return o.text()
}

/** xPawn's file name: h_0_<store number>_<YYYYMMDDhhmm>.xml, shop time. */
export function leadsOnlineFilename(storeNumber: string, at: Date, timeZone: string): string {
  const t = shopDateTime(at.toISOString(), timeZone)
  return `h_0_${storeNumber}_${t.slice(0, 4)}${t.slice(5, 7)}${t.slice(8, 10)}${t.slice(11, 13)}${t.slice(14, 16)}.xml`
}
