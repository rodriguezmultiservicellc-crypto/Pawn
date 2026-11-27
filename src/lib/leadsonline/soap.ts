/**
 * LeadsOnline web service (ticketWS.asmx) — the SOAP messages, pure.
 *
 * Built to the live WSDL (w3apisandbox.leadsonline.com/ticketWS.asmx?wsdl,
 * read 2026-11-27), which differs from the "Pawn Industry Web Service
 * Template" PDF in two ways the PDF never mentions:
 *   - every call starts with ApiVersion (nillable int, sent xsi:nil) and an
 *     optional IpAddress;
 *   - each call's children are a strict sequence — CheckDoNotBuy2 takes
 *     BirthDate, ID, IpAddress, Name, login IN THAT ORDER.
 * SOAP 1.1, SOAPAction "http://www.leadsonline.com/<Method>", elements in
 * the http://www.leadsonline.com/ namespace.
 *
 * A ticket is built from a compliance_log row only (rule 15) — the same
 * snapshot the XML file is made from (formats/fl-leadsonline-xml.ts), whose
 * field helpers it reuses so the two can never describe a ticket
 * differently.
 */

import type { ComplianceLogRow } from '@/types/database-aliases'
import { purityScaleOf } from '@/lib/spot-prices/purity'
import { itemIdentity } from '@/lib/pawn/item-identity'
import { normalizeStones } from '@/lib/pawn/stones'
import {
  idTypeText,
  metalText,
  shopDateTime,
  ticketNumberText,
} from '@/lib/compliance/police-report/formats/fl-leadsonline-xml'

export const LEADSONLINE_NS = 'http://www.leadsonline.com/'

export type LeadsOnlineEnv = 'sandbox' | 'production'

/** The service address (top of page 18 of the API document, and the WSDL). */
export const LEADSONLINE_ENDPOINTS: Record<LeadsOnlineEnv, string> = {
  sandbox: 'https://w3apisandbox.leadsonline.com/ticketWS.asmx',
  production: 'https://w3api.leadsonline.com/ticketWS.asmx',
}

export type LeadsOnlineMethod =
  | 'CheckLogin'
  | 'SubmitTransaction'
  | 'UpdateTransaction'
  | 'CheckDoNotBuy2'
  | 'SetNoTransactionDayForStore'

export type LoginInfo = { storeId: number; userName: string; password: string }

export type ImageCategory = 'Customer' | 'CustomerID' | 'Thumbprint' | 'Signature' | 'Document' | 'Item'
export type ImageType = 'Jpeg' | 'Png' | 'Gif' | 'Pdf'
export type SoapImage = { category: ImageCategory; type: ImageType; base64: string }

export type TicketKey = { ticketType: 'Pawn' | 'Buy'; ticketnumber: string; ticketDateTime: string }

type Pv = { name: string; value: string }

export type SoapItem = {
  make: string
  model: string
  serialNumber: string
  description: string
  amount: number
  itemType: 'Other' | 'Jewelry' | 'Firearm'
  itemStatus: string
  isVoid: boolean
  employee: string
  images: SoapImage[]
  extra: Pv[]
}

export type SoapCustomer = {
  fname: string
  lname: string
  address1: string
  address2: string
  city: string
  state: string
  postalCode: string
  phone: string
  idType: string
  idNumber: string
  dob: string
  weight: number
  height: number
  eyeColor: string
  hairColor: string
  race: string
  sex: string
  remarks: string
  images: SoapImage[]
  extra: Pv[]
}

export type SoapTicket = {
  key: TicketKey
  redeemByDate: string
  customer: SoapCustomer
  items: SoapItem[]
  isVoid: boolean
  extra: Pv[]
}

// ── Small helpers ────────────────────────────────────────────────────────────

type Obj = Record<string, unknown>

const s = (v: unknown): string =>
  v == null ? '' : typeof v === 'string' ? v.trim() : typeof v === 'number' || typeof v === 'boolean' ? String(v) : ''

/** Text for an element or attribute. */
export function xmlEscape(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

const el = (tag: string, value: string) => `<${tag}>${xmlEscape(value)}</${tag}>`

/** "2026-11-17T16:34:00" (shop time) → "11/17/2026 16:34", a format the API
 *  document lists for ticketDateTime. */
export function apiDateTime(iso: string, timeZone: string): string {
  const t = shopDateTime(iso, timeZone)
  return `${t.slice(5, 7)}/${t.slice(8, 10)}/${t.slice(0, 4)} ${t.slice(11, 16)}`
}

/** 10 digits → 813-876-3119 (as the samples write it); anything else as typed. */
function phoneText(v: unknown): string {
  const d = s(v).replace(/\D/g, '')
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d
  return ten.length === 10 ? `${ten.slice(0, 3)}-${ten.slice(3, 6)}-${ten.slice(6)}` : s(v)
}

const intOr0 = (v: unknown) => {
  const n = typeof v === 'number' ? v : parseInt(s(v), 10)
  return isFinite(n) && n > 0 ? Math.round(n) : 0
}

const money = (v: unknown) => {
  const n = typeof v === 'number' ? v : parseFloat(s(v))
  return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0
}

/** PropertyValues must be non-empty and unique by name (API doc, p. 11). */
function pvs(list: ReadonlyArray<[string, string]>): Pv[] {
  const seen = new Set<string>()
  const out: Pv[] = []
  for (const [name, value] of list) {
    if (!value || seen.has(name)) continue
    seen.add(name)
    out.push({ name, value })
  }
  return out
}

const JEWELRY_CATEGORIES = new Set(['ring', 'necklace', 'bracelet', 'earrings', 'pendant', 'chain', 'watch', 'loose_stone', 'jewelry'])
const GENDER: Record<string, string> = { men: 'M', women: 'F', unisex: 'N' }

function itemTypeOf(it: Obj): SoapItem['itemType'] {
  if (s(it.pawn_category_slug) === 'firearms' || s(it.firearm_serial_number) || s(it.firearm_make)) return 'Firearm'
  if (s(it.pawn_category_slug) === 'jewelry' || JEWELRY_CATEGORIES.has(s(it.category))) return 'Jewelry'
  return 'Other'
}

/** The image type LeadsOnline takes for a stored file, by its extension;
 *  null = a type it does not take (webp, heic) — not sent. */
export function imageTypeOfPath(path: string): ImageType | null {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'jpg' || ext === 'jpeg') return 'Jpeg'
  if (ext === 'png') return 'Png'
  if (ext === 'gif') return 'Gif'
  if (ext === 'pdf') return 'Pdf'
  return null
}

/** Every photo path an item snapshot carries, main first (rule 28). */
export function itemPhotoPaths(it: Obj): string[] {
  const list = (v: unknown) => (Array.isArray(v) ? v.map(s).filter(Boolean) : [])
  // Pawn items keep photo_path + extra_photo_paths; buys also photo_paths.
  return [...new Set([s(it.photo_path), ...list(it.extra_photo_paths), ...list(it.photo_paths)].filter(Boolean))]
}

// ── compliance_log row → Ticket ─────────────────────────────────────────────

export type TicketImages = {
  customer: SoapImage[]
  /** By item position in items_snapshot. */
  items: SoapImage[][]
}

/** The ticket key LeadsOnline knows this compliance row by. */
export function ticketKeyOf(row: Pick<ComplianceLogRow, 'event_type' | 'reference_number' | 'occurred_at'>, timeZone: string): TicketKey {
  return {
    ticketType: row.event_type === 'buy_outright' ? 'Buy' : 'Pawn',
    ticketnumber: ticketNumberText(row),
    ticketDateTime: apiDateTime(row.occurred_at, timeZone),
  }
}

export function ticketFromComplianceRow(args: {
  row: ComplianceLogRow
  voided: boolean
  timeZone: string
  ncicBySlug?: Record<string, string>
  images?: TicketImages
}): SoapTicket {
  const { row, voided, timeZone } = args
  const ncicBySlug = args.ncicBySlug ?? {}
  const c = (row.customer_snapshot ?? {}) as Obj
  const items = Array.isArray(row.items_snapshot) ? (row.items_snapshot as Obj[]) : []
  const buy = row.event_type === 'buy_outright'
  const clerk = s(row.clerk)

  const customer: SoapCustomer = {
    fname: s(c.first_name),
    lname: s(c.last_name),
    address1: s(c.address1),
    address2: s(c.address2),
    city: s(c.city),
    state: s(c.state).toUpperCase(),
    postalCode: s(c.zip),
    phone: phoneText(c.phone),
    idType: idTypeText(c.id_type),
    idNumber: s(c.id_number),
    dob: s(c.date_of_birth).slice(0, 10),
    weight: intOr0(c.weight_lbs),
    height: intOr0(c.height_inches),
    eyeColor: s(c.eye_color),
    hairColor: s(c.hair_color),
    race: s(c.race),
    sex: s(c.sex).slice(0, 1).toUpperCase(),
    remarks: s(c.identifying_marks),
    images: args.images?.customer ?? [],
    extra: pvs([
      ['CUSTOMER_STORE_NUMBER', s(c.id)],
      ['CUSTOMER_NAME_MIDDLE', s(c.middle_name)],
      ['CUSTOMER_ID_CATEGORY1', idTypeText(c.id_type)],
      ['CUSTOMER_ID_ISSUER1', s(c.id_state).toUpperCase()],
      ['CUSTOMER_ID_EXPIRATION1', s(c.id_expiry).slice(0, 10)],
      ['CUSTOMER_EMPLOYER', s(c.place_of_employment)],
      ['CUSTOMER_EMAIL', s(c.email)],
    ]),
  }

  const soapItems: SoapItem[] = items.map((it, i) => {
    const id = itemIdentity(it)
    const type = itemTypeOf(it)
    const jewelry = type === 'Jewelry'
    const stones = normalizeStones(it.stones)
    const ncic = ncicBySlug[s(it.pawn_subcategory_slug)] ?? ncicBySlug[s(it.pawn_category_slug)] ?? ''
    const weight = typeof it.weight_grams === 'number' ? it.weight_grams : parseFloat(s(it.weight_grams))
    const stoneProps: Array<[string, string]> = []
    for (const n of [1, 2] as const) {
      const st = stones[n - 1]
      if (!st) continue
      stoneProps.push(
        [`JEWELRY_STONE${n}_TYPE`, st.type ?? ''],
        [`JEWELRY_STONE${n}_COLOR`, st.color ?? ''],
        [`JEWELRY_STONE${n}_QUANTITY`, st.qty != null ? String(st.qty) : ''],
        [`JEWELRY_STONE${n}_SHAPE`, st.cut ?? ''],
        [`JEWELRY_STONE${n}_CARAT`, st.carat != null ? String(st.carat) : ''],
      )
    }
    return {
      make: id.brand || s(it.brand),
      model: id.model || s(it.model),
      serialNumber: id.serial || s(it.serial_number),
      description: s(it.description),
      // A pawn: what the item is worth on the ticket; a buy: what was paid
      // for it — the same amounts the XML file sends.
      amount: money(buy ? it.payout : it.est_value),
      itemType: type,
      itemStatus: buy ? 'Buy' : 'Pawn',
      isVoid: voided,
      employee: clerk,
      images: args.images?.items[i] ?? [],
      extra: pvs([
        ['STORE_NCIC_CODE', ncic],
        ['ITEM_QUANTITY', '1'],
        ['ITEM_COLOR', jewelry ? '' : s(it.color)],
        ['ITEM_NOTES', s(it.unique_marks)],
        ['JEWELRY_STYLE', jewelry ? s(it.jewelry_style) : ''],
        ['JEWELRY_METAL', jewelry ? metalText(it.metal_type, it.color) : ''],
        // Karats for gold only (rule 31): a silver 925 rides in the description.
        ['JEWELRY_KARAT', jewelry && purityScaleOf(s(it.metal_type)) === 'karat' ? s(it.karat).replace(/\D/g, '') : ''],
        ['JEWELRY_WEIGHT', jewelry && isFinite(weight) && weight > 0 ? String(Number(weight.toFixed(2))) : ''],
        ['JEWELRY_WEIGHT_UNIT', jewelry && isFinite(weight) && weight > 0 ? 'grams' : ''],
        ['JEWELRY_SIZE', s(it.jewelry_size) || s(it.item_size)],
        ['JEWELRY_GENDER', jewelry ? (GENDER[s(it.jewelry_gender)] ?? '') : ''],
        ...stoneProps,
        ['FIREARM_CALIBER', s(it.firearm_caliber)],
        ['FIREARM_TYPE', s(it.firearm_type)],
        ['FIREARM_ACTION', s(it.firearm_action_type)],
        ['FIREARM_FINISH', s(it.firearm_finish)],
        ['FIREARM_BARREL_LENGTH', s(it.firearm_barrel_length_inches)],
      ]),
    }
  })

  return {
    key: ticketKeyOf(row, timeZone),
    // The maturity date on the pawn ticket (patches/0125); YYYY-MM-DD is a
    // format the API document lists. None for a buy or a pre-0125 pawn.
    redeemByDate: buy ? '' : s(row.redeem_by).slice(0, 10),
    customer,
    items: soapItems,
    isVoid: voided,
    extra: pvs([['TICKET_LOAN_AMOUNT', row.amount != null && Number(row.amount) > 0 ? String(money(row.amount)) : '']]),
  }
}

// ── Serialization (WSDL element order) ──────────────────────────────────────

function loginXml(l: LoginInfo): string {
  return `<login>${el('storeId', String(l.storeId))}${el('userName', l.userName)}${el('password', l.password)}</login>`
}

function keyXml(tag: string, k: TicketKey): string {
  return `<${tag}>${el('ticketType', k.ticketType)}${el('ticketnumber', k.ticketnumber)}${el('ticketDateTime', k.ticketDateTime)}</${tag}>`
}

function imagesXml(list: SoapImage[]): string {
  if (list.length === 0) return ''
  return `<images>${list
    .map((im) => `<Image>${el('imageCategory', im.category)}${el('imageType', im.type)}<imageData>${im.base64}</imageData></Image>`)
    .join('')}</images>`
}

function pvXml(tag: string, list: Pv[]): string {
  if (list.length === 0) return ''
  return `<${tag}>${list.map((p) => `<PropertyValue>${el('Name', p.name)}${el('Value', p.value)}</PropertyValue>`).join('')}</${tag}>`
}

/** Optional string elements are left out when empty; required ones never. */
const opt = (tag: string, v: string) => (v ? el(tag, v) : '')

export function ticketXml(t: SoapTicket): string {
  const c = t.customer
  const customer =
    '<customer>' +
    opt('fname', c.fname) +
    opt('lname', c.lname) +
    opt('address1', c.address1) +
    opt('address2', c.address2) +
    opt('city', c.city) +
    opt('state', c.state) +
    opt('postalCode', c.postalCode) +
    opt('phone', c.phone) +
    opt('idType', c.idType) +
    opt('idNumber', c.idNumber) +
    opt('dob', c.dob) +
    el('weight', String(c.weight)) +
    el('height', String(c.height)) +
    opt('eyeColor', c.eyeColor) +
    opt('hairColor', c.hairColor) +
    opt('race', c.race) +
    opt('sex', c.sex) +
    opt('remarks', c.remarks) +
    imagesXml(c.images) +
    pvXml('extraCustomer', c.extra) +
    '</customer>'
  const items =
    t.items.length === 0
      ? ''
      : `<items>${t.items
          .map(
            (it) =>
              '<Item>' +
              opt('make', it.make) +
              opt('model', it.model) +
              opt('serialNumber', it.serialNumber) +
              opt('description', it.description) +
              el('amount', it.amount.toFixed(2)) +
              el('itemType', it.itemType) +
              opt('itemStatus', it.itemStatus) +
              imagesXml(it.images) +
              el('isVoid', String(it.isVoid)) +
              opt('employee', it.employee) +
              pvXml('extraItem', it.extra) +
              '</Item>',
          )
          .join('')}</items>`
  return (
    '<ticket>' +
    keyXml('key', t.key) +
    opt('redeemByDate', t.redeemByDate) +
    customer +
    items +
    el('isVoid', String(t.isVoid)) +
    pvXml('extraTicket', t.extra) +
    '</ticket>'
  )
}

const API_VERSION = '<ApiVersion xsi:nil="true"/>'

export function envelope(method: LeadsOnlineMethod, inner: string): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
    `<soap:Body><${method} xmlns="${LEADSONLINE_NS}">${inner}</${method}></soap:Body></soap:Envelope>`
  )
}

export function checkLoginEnvelope(login: LoginInfo): string {
  return envelope('CheckLogin', API_VERSION + loginXml(login))
}

export function submitTransactionEnvelope(login: LoginInfo, ticket: SoapTicket): string {
  return envelope('SubmitTransaction', API_VERSION + loginXml(login) + ticketXml(ticket))
}

export function updateTransactionEnvelope(login: LoginInfo, oldKey: TicketKey, ticket: SoapTicket): string {
  return envelope('UpdateTransaction', API_VERSION + loginXml(login) + keyXml('oldTicket', oldKey) + ticketXml(ticket))
}

/** Either the ID alone, or at least two of the three (API doc, p. 15).
 *  BirthDate is MM/DD/YYYY, as the sample sends it. */
export function checkDoNotBuy2Envelope(
  login: LoginInfo,
  q: { id: string; name: string; birthDate: string },
): string {
  return envelope(
    'CheckDoNotBuy2',
    API_VERSION + opt('BirthDate', q.birthDate) + opt('ID', q.id) + opt('Name', q.name) + loginXml(login),
  )
}

/** "2026-11-26" → "11/26/2026", the TransactionDate format (API doc, p. 16). */
export function usDateOf(isoDay: string): string {
  return `${isoDay.slice(5, 7)}/${isoDay.slice(8, 10)}/${isoDay.slice(0, 4)}`
}

/** A day the store had no transactions. WSDL order: TransactionDate, login. */
export function setNoTransactionDayEnvelope(login: LoginInfo, isoDay: string): string {
  return envelope('SetNoTransactionDayForStore', API_VERSION + el('TransactionDate', usDateOf(isoDay)) + loginXml(login))
}

// ── Responses ───────────────────────────────────────────────────────────────

export type LeadsOnlineResponse =
  | { kind: 'response'; errorCode: number; errorResponse: string }
  | { kind: 'fault'; message: string }

function decode(v: string): string {
  return v
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** First <tag>…</tag> (any namespace prefix) in a string. */
function first(xml: string, tag: string): string | null {
  const m = new RegExp(`<(?:[\\w-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`).exec(xml)
  if (m) return decode(m[1].trim())
  return new RegExp(`<(?:[\\w-]+:)?${tag}(?:\\s[^>]*)?/>`).test(xml) ? '' : null
}

function fault(xml: string): string | null {
  if (!/<(?:[\w-]+:)?Fault[\s>]/.test(xml)) return null
  return first(xml, 'faultstring') ?? 'SOAP fault'
}

/** The Response of CheckLogin / SubmitTransaction / UpdateTransaction. */
export function parseResponse(xml: string): LeadsOnlineResponse {
  const f = fault(xml)
  if (f != null) return { kind: 'fault', message: f }
  const code = first(xml, 'errorCode')
  if (code == null || !/^-?\d+$/.test(code)) return { kind: 'fault', message: 'no_response' }
  return { kind: 'response', errorCode: parseInt(code, 10), errorResponse: first(xml, 'errorResponse') ?? '' }
}

export type DoNotBuyInfo = {
  agency: string
  ID: string
  state: string
  name: string
  dob: string
  contactName: string
  contactNumber: string
}

export function parseDoNotBuy(xml: string): { kind: 'hits'; hits: DoNotBuyInfo[] } | { kind: 'fault'; message: string } {
  const f = fault(xml)
  if (f != null) return { kind: 'fault', message: f }
  const hits: DoNotBuyInfo[] = []
  const re = /<(?:[\w-]+:)?DoNotBuyInfo(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w-]+:)?DoNotBuyInfo>/g
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const b = m[1]
    hits.push({
      agency: first(b, 'agency') ?? '',
      ID: first(b, 'ID') ?? '',
      state: first(b, 'state') ?? '',
      name: first(b, 'name') ?? '',
      dob: first(b, 'dob') ?? '',
      contactName: first(b, 'contactName') ?? '',
      contactNumber: first(b, 'contactNumber') ?? '',
    })
  }
  return { kind: 'hits', hits }
}
