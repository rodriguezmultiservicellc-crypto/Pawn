/**
 * A New repair ticket saved as a draft (patches/0118), so it can move to
 * another device with a QR code. Pure: the server builds the payload from the
 * form's FormData (the same li_<n>_* / stone_<n>_* fields the ticket submits)
 * and the page reads it back with parseRepairDraftPayload. A draft is never a
 * ticket — opening the ticket validates everything as usual.
 *
 * Each item keeps its photos' paths (already uploaded by the browser,
 * patches/0119); the page signs them again when the draft opens.
 */

import type { ServiceType } from '@/types/database-aliases'
import { SERVICE_TYPES } from '@/lib/repair/stages'

export type RepairDraftLineItem = {
  item_type: string
  karat: string
  weight_grams: string
  dimension: string
  service_type: ServiceType
  /** The clerk picked the service (the Simple view asks for it). */
  service_touched: boolean
  work_needed: string
  /** The item's photo paths, main first (repair-photos/<tenant>/intake/…). */
  photos: string[]
}

export type RepairDraftStone = {
  stone_type: string
  shape: string
  size_mm: string
  weight_carats: string
  color: string
  clarity: string
  mounting_type: string
  mounting_position: string
  source: 'customer_supplied' | 'shop_supplied'
  notes: string
}

export type RepairDraftPayload = {
  line_items: RepairDraftLineItem[]
  stones: RepairDraftStone[]
  promised_date: string
  assigned_to: string
  notes_internal: string
  est_labor: string
  est_materials: string
  est_deposit: string
}

const MAX_ITEMS = 30
const MAX_STONES = 50

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const serviceOf = (v: unknown): ServiceType =>
  SERVICE_TYPES.includes(v as ServiceType) ? (v as ServiceType) : 'repair'
const sourceOf = (v: unknown): RepairDraftStone['source'] =>
  v === 'shop_supplied' ? 'shop_supplied' : 'customer_supplied'
/** A JSON list of paths (the form) or a list (a stored payload) → strings.
 *  Whose folder they are in is checked when they are signed or recorded. */
const pathsOf = (v: unknown): string[] => {
  let list: unknown = v
  if (typeof v === 'string') {
    try {
      list = JSON.parse(v)
    } catch {
      return []
    }
  }
  return Array.isArray(list) ? list.filter((p): p is string => typeof p === 'string') : []
}
const countOf = (v: unknown, max: number) =>
  Math.max(0, Math.min(max, parseInt(str(v), 10) || 0))

function lineItemFrom(get: (field: string) => unknown): RepairDraftLineItem {
  return {
    item_type: str(get('item_type')),
    karat: str(get('karat')),
    weight_grams: str(get('weight_grams')),
    dimension: str(get('dimension')),
    service_type: serviceOf(get('service_type')),
    service_touched: get('service_touched') === true || get('service_touched') === '1',
    work_needed: str(get('work_needed')),
    photos: pathsOf(get('photos')),
  }
}

function stoneFrom(get: (field: string) => unknown): RepairDraftStone {
  return {
    stone_type: str(get('stone_type')),
    shape: str(get('shape')),
    size_mm: str(get('size_mm')),
    weight_carats: str(get('weight_carats')),
    color: str(get('color')),
    clarity: str(get('clarity')),
    mounting_type: str(get('mounting_type')),
    mounting_position: str(get('mounting_position')),
    source: sourceOf(get('source')),
    notes: str(get('notes')),
  }
}

/** The form as it is now. Every item row is kept, built or not. */
export function buildRepairDraftPayload(fd: FormData): RepairDraftPayload {
  const items = Array.from({ length: countOf(fd.get('line_item_count'), MAX_ITEMS) }, (_, i) =>
    lineItemFrom((f) => fd.get(`li_${i}_${f}`)),
  )
  // stone_<n>_type, not stone_<n>_stone_type: the form's own field names.
  const stones = Array.from({ length: countOf(fd.get('stone_count'), MAX_STONES) }, (_, i) =>
    stoneFrom((f) => fd.get(`stone_${i}_${f === 'stone_type' ? 'type' : f}`)),
  )
  return {
    line_items: items,
    stones,
    promised_date: str(fd.get('promised_date')),
    assigned_to: str(fd.get('assigned_to')),
    notes_internal: str(fd.get('notes_internal')),
    est_labor: str(fd.get('est_labor')),
    est_materials: str(fd.get('est_materials')),
    est_deposit: str(fd.get('est_deposit')),
  }
}

/** A stored payload, whatever shape it has, as the form can use it. */
export function parseRepairDraftPayload(raw: unknown): RepairDraftPayload {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const rows = (v: unknown, max: number) =>
    (Array.isArray(v) ? v : [])
      .slice(0, max)
      .map((r) => (r && typeof r === 'object' ? (r as Record<string, unknown>) : {}))
  return {
    line_items: rows(o.line_items, MAX_ITEMS).map((r) => lineItemFrom((f) => r[f])),
    stones: rows(o.stones, MAX_STONES).map((r) => stoneFrom((f) => r[f])),
    promised_date: str(o.promised_date),
    assigned_to: str(o.assigned_to),
    notes_internal: str(o.notes_internal),
    est_labor: str(o.est_labor),
    est_materials: str(o.est_materials),
    est_deposit: str(o.est_deposit),
  }
}
