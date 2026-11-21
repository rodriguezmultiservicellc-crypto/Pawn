/**
 * Lightspeed Retail (X-Series) product export → inventory_items inserts.
 * Pure logic, no I/O: the route handler parses the CSV, loads the refs that
 * were already imported, calls mapLightspeedRows(), and inserts the records.
 *
 * Lightspeed is quantity-based (one product row, on-hand count per outlet);
 * Sol Pawn is piece-based (one row per physical piece, sold once — sale
 * lines with an inventory item must have quantity 1). So a row with 3 on
 * hand becomes 3 items, each with its own Sol Pawn SKU (assigned by the
 * BEFORE INSERT trigger) and import_ref '<product id>#1..3'.
 *
 * The Lightspeed SKU goes to legacy_code: it is what the shop's existing
 * barcode tags carry, and the scan resolver matches it (lib/labels/resolve).
 * It is not unique in Lightspeed (and never per piece), so it cannot be the
 * Sol Pawn SKU.
 *
 * Imported and NOT imported:
 *   - on hand <= 0                → skipped (nothing on the shelf)
 *   - track_inventory = 0         → skipped (services: repairs, locks, credit)
 *   - category repair / credit    → skipped (same, when mis-flagged tracked)
 *   - inactive (active = 0)       → skipped
 *   - unit already imported       → skipped (idempotent re-run)
 */

import type { Database } from '@/types/database'
import { inventoryItemCreateSchema } from '@/lib/validations/inventory'

type Category = Database['public']['Enums']['inventory_category']
type Metal = Database['public']['Enums']['metal_type']
type Coating = Database['public']['Enums']['inventory_coating']

export const LIGHTSPEED_SOURCE = 'lightspeed'

/** Safety valve on one product row (a mis-keyed 9999 would flood the book). */
export const MAX_UNITS_PER_ROW = 500

const GRAMS_PER_DWT = 1.55517384

/** Columns the export must have; the outlet-suffixed ones are detected. */
const REQUIRED_HEADERS = ['id', 'sku', 'name', 'supply_price', 'retail_price'] as const

export type LightspeedReport = {
  totalRows: number
  /** Item rows that will be created (one per unit). */
  toInsert: number
  /** Product rows those units come from. */
  productsImported: number
  skippedNoStock: number
  skippedService: number
  skippedInactive: number
  /** Units already imported by an earlier run. */
  skippedExisting: number
  skippedInvalid: number
  /** Rows whose on-hand count was above MAX_UNITS_PER_ROW (capped). */
  cappedRows: number
  /** Imported units with no weight found anywhere in the row. */
  noWeight: number
  /** Imported units with no retail price. */
  noPrice: number
}

export type LightspeedSample = {
  description: string
  category: Category
  metal: Metal | null
  karat: string | null
  weight_grams: number | null
  cost_basis: number
  list_price: number | null
  legacy_code: string | null
  units: number
}

export type InventoryImportInsert = Database['public']['Tables']['inventory_items']['Insert']

export type LightspeedHeaderCheck =
  | { ok: true; outlets: string[] }
  | { ok: false; missing: string[] }

/** Is this a Lightspeed export, and which outlets does it carry stock for? */
export function checkLightspeedHeaders(headers: string[]): LightspeedHeaderCheck {
  const set = new Set(headers)
  const missing = REQUIRED_HEADERS.filter((h) => !set.has(h))
  const outlets = headers
    .filter((h) => h.startsWith('inventory_') && h.length > 'inventory_'.length)
    .map((h) => h.slice('inventory_'.length))
  if (outlets.length === 0) missing.push('inventory_<outlet>' as never)
  return missing.length ? { ok: false, missing: [...missing] } : { ok: true, outlets }
}

// ── field helpers ────────────────────────────────────────────────────────

function str(v: string | undefined | null): string | null {
  if (v == null) return null
  const t = v.replace(/\s+/g, ' ').trim()
  return t === '' ? null : t
}

function money(v: string | undefined | null): number | null {
  const t = str(v)
  if (!t) return null
  const n = Number(t.replace(/[$,]/g, ''))
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 10000) / 10000 : null
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}

const ENTITIES: Record<string, string> = {
  nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', '#39': "'",
}

/** Lightspeed descriptions are HTML. Keep the words, drop the markup. */
export function htmlToText(html: string | undefined | null): string | null {
  if (!html) return null
  const text = html
    .replace(/<\s*(br|\/p|\/div|\/li)\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#\d+|[a-z]+);/gi, (m, e: string) => {
      const k = e.toLowerCase()
      if (ENTITIES[k] != null) return ENTITIES[k]
      if (k.startsWith('#')) {
        const code = Number(k.slice(1))
        return Number.isFinite(code) ? String.fromCharCode(code) : m
      }
      return m
    })
    .replace(/ /g, ' ')
  const lines = text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  return lines.length ? lines.join(' · ') : null
}

function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`
}

// ── category ─────────────────────────────────────────────────────────────

const WATCH_BRANDS = /\b(armitron|invicta|casio|seiko|citizen|michael kors|orient|nine west|timex|fossil|bulova|g-?shock|rolex|guess)\b/i

function categoryFromText(text: string): Category | null {
  const n = text.toLowerCase()
  if (/\b(wedding|bridal|engagement)\s+(set|ring|band)s?\b/.test(n)) return 'ring'
  if (/earring|\bhoops?\b|\bstuds?\b|huggies?|piercing|\bnose\b|\bbelly\b|lever\s?backs?|dangles?/.test(n)) return 'earrings'
  if (/\brings?\b|\bbands?\b|\bsolitaire\b/.test(n)) return 'ring'
  if (/bracelet|anklet|bangle/.test(n)) return 'bracelet'
  if (/\bchains?\b|curb|rope|figaro|cuban|franco|box link|mariner|gucci|herringbone|singapore|\bsnake\b/.test(n)) return 'chain'
  if (/necklace|rosary|choker/.test(n)) return 'necklace'
  if (/charm|pendant|medal|medallion|cross|crucifix|saint|medalla|azabache|caridad|virgen|guadalupe|dios me|hamsa/.test(n)) return 'pendant'
  if (/\bcoin\b/.test(n)) return 'coin'
  return null
}

/**
 * Lightspeed's free-text product_category first; then the name; then the
 * variant values ("10k Heart — Necklace/2.0g"); then a watch brand.
 */
export function mapCategory(
  productCategory: string | null,
  name: string,
  brand: string | null,
  variants: string | null = null,
): Category {
  const c = (productCategory ?? '').toLowerCase().trim()
  if (c) {
    if (/ring/.test(c) && !/ear/.test(c)) return 'ring'
    if (/ear|piercing|stud|hoop/.test(c)) return 'earrings'
    if (/bracelet|anklet|bangle/.test(c)) return 'bracelet'
    if (/chain/.test(c)) return 'chain'
    if (/charm|pendant|medal/.test(c)) return 'pendant'
    if (/necklace|rosary|choker/.test(c)) return 'necklace'
    if (/watch/.test(c)) return 'watch'
    if (/coin/.test(c)) return 'coin'
    if (/bullion|bar/.test(c)) return 'bullion'
    // Anything else ('set', 'Pin', ...) falls through to the text.
  }
  if (/\bwatch(es)?\b/.test(name.toLowerCase()) || WATCH_BRANDS.test(name) || (brand && WATCH_BRANDS.test(brand))) {
    return 'watch'
  }
  return categoryFromText(name) ?? (variants ? categoryFromText(variants) : null) ?? 'other'
}

// ── metal / karat / coating ──────────────────────────────────────────────

export type MetalGuess = { metal: Metal | null; karat: string | null; coating: Coating }

/**
 * Read metal facts from the row text. Name first (most deliberate), then
 * tags, handle and description, so a "10k" in the name wins over a "14k"
 * mentioned in passing in a description.
 */
export function guessMetal(parts: Array<string | null>): MetalGuess {
  const texts = parts.filter((p): p is string => !!p).map((p) => p.toLowerCase())
  const all = texts.join(' | ')

  let coating: Coating = 'none'
  if (/vermeil/.test(all)) coating = 'vermeil'
  else if (/gold[\s-]*fill(ed)?|\bgf\b/.test(all)) coating = 'gold_filled'
  // Not a bare "plated": solid white gold is routinely "rhodium plated".
  else if (/gold[\s-]*plat(ed|ing)?|\bgp\b/.test(all)) coating = 'gold_plated'
  else if (/\bpvd\b/.test(all)) coating = 'pvd'

  let karat: string | null = null
  for (const t of texts) {
    // Not "ct" — that is carat (stone weight), not karat.
    // "10ky" / "14kw" / "14kyg" = karat + color shorthand.
    const m = /(?:^|[^0-9./])(10|14|18|22|24)\s*(?:k|kt|karat)(?:yg|wg|rg|y|w|r)?\b/.exec(t)
    if (m) { karat = `${m[1]}K`; break }
  }

  let metal: Metal | null = null
  if (karat) {
    const white = /white\s*gold|\bwg\b/.test(all)
    const rose = /rose\s*gold|\brg\b|pink\s*gold/.test(all)
    const yellow = /yellow\s*gold|\byg\b/.test(all)
    metal = white && !rose && !yellow ? 'white_gold' : rose && !white && !yellow ? 'rose_gold' : 'gold'
  } else if (/\b925\b|sterling/.test(all)) {
    metal = 'silver'
    karat = '925'
  } else if (/\bsilver\b|\bplata\b/.test(all)) {
    metal = 'silver'
  } else if (/platinum|\bpt\s?950\b/.test(all)) {
    metal = 'platinum'
  } else if (/stainless/.test(all)) {
    metal = 'stainless_steel'
  } else if (/tungsten/.test(all)) {
    metal = 'tungsten'
  } else if (/titanium/.test(all)) {
    metal = 'titanium'
  } else if (/\bgold\b|\boro\b/.test(all)) {
    metal = 'gold'
  }
  return { metal, karat, coating }
}

// ── weight ───────────────────────────────────────────────────────────────

const GRAMS_RE = /(\d+(?:\.\d+)?|\.\d+)\s*(?:g|gr|grs|gms?|grams?|gramos?)(?![a-z])/i

function plausibleGrams(n: number): number | null {
  return Number.isFinite(n) && n > 0 && n < 2000 ? round4(n) : null
}

/**
 * Grams, from (in order): weight + weight_unit=G, a variant value
 * ("2.5mm /1.9g/5.5\"" or a bare "2.4" under an option named grams/weight),
 * the name, the description. Lightspeed's default weight_unit is LB with
 * 0 — never trusted.
 */
export function findGrams(row: Record<string, string>): number | null {
  if ((row.weight_unit ?? '').trim().toUpperCase() === 'G') {
    const g = plausibleGrams(Number(row.weight))
    if (g) return g
  }
  for (const k of ['one', 'two', 'three'] as const) {
    const label = (row[`variant_option_${k}_name`] ?? '').toLowerCase()
    const value = row[`variant_option_${k}_value`] ?? ''
    const m = GRAMS_RE.exec(value)
    if (m) { const g = plausibleGrams(Number(m[1])); if (g) return g }
    if (/gram|weight|peso/.test(label)) {
      const bare = /^\s*(\d+(?:\.\d+)?|\.\d+)\s*$/.exec(value)
      if (bare) { const g = plausibleGrams(Number(bare[1])); if (g) return g }
    }
  }
  for (const src of [row.name, htmlToText(row.description)]) {
    const m = src ? GRAMS_RE.exec(src) : null
    if (m) { const g = plausibleGrams(Number(m[1])); if (g) return g }
  }
  return null
}

// ── description / tags ───────────────────────────────────────────────────

function variantSummary(row: Record<string, string>): string | null {
  const vals = (['one', 'two', 'three'] as const)
    .map((k) => str(row[`variant_option_${k}_value`]))
    .filter((v): v is string => !!v)
  return vals.length ? vals.join(' · ') : null
}

function splitTags(raw: string | undefined): string[] {
  const out: string[] = []
  for (const t of (raw ?? '').split(/[;,]/)) {
    const v = t.trim().toLowerCase().replace(/\s+/g, ' ')
    if (v && v.length <= 40 && !out.includes(v)) out.push(v)
    if (out.length === 20) break
  }
  return out
}

// ── main mapping ─────────────────────────────────────────────────────────

export type LightspeedMapOptions = {
  rows: Array<Record<string, string>>
  outlet: string
  tenantId: string
  createdBy: string
  /** YYYY-MM-DD in the shop's timezone. */
  acquiredAt: string
  /** import_ref values already present for this tenant + source. */
  existingRefs: Set<string>
}

const SERVICE_CATEGORY = /^(repair|repairs|service|services|credit|gift ?card)$/i
/** Lightspeed shops key store credit / gift cards as tracked "products". */
const SERVICE_NAME = /^(store\s+)?credit$|^gift\s?card$/i

export function mapLightspeedRows(opts: LightspeedMapOptions): {
  records: InventoryImportInsert[]
  report: LightspeedReport
  samples: LightspeedSample[]
} {
  const { rows, outlet, tenantId, createdBy, acquiredAt, existingRefs } = opts
  const report: LightspeedReport = {
    totalRows: rows.length,
    toInsert: 0,
    productsImported: 0,
    skippedNoStock: 0,
    skippedService: 0,
    skippedInactive: 0,
    skippedExisting: 0,
    skippedInvalid: 0,
    cappedRows: 0,
    noWeight: 0,
    noPrice: 0,
  }
  const records: InventoryImportInsert[] = []
  const samples: LightspeedSample[] = []
  const stockCol = `inventory_${outlet}`

  for (const row of rows) {
    const productId = str(row.id)
    const name = str(row.name)
    if (!productId || !name) { report.skippedInvalid++; continue }

    if (row.active != null && row.active.trim() === '0') { report.skippedInactive++; continue }
    if (
      (row.track_inventory ?? '').trim() === '0' ||
      SERVICE_CATEGORY.test((row.product_category ?? '').trim()) ||
      SERVICE_NAME.test(name)
    ) {
      report.skippedService++
      continue
    }

    const onHandRaw = Number((row[stockCol] ?? '').trim())
    const onHand = Number.isFinite(onHandRaw) ? Math.floor(onHandRaw) : 0
    if (onHand <= 0) { report.skippedNoStock++; continue }
    let units = onHand
    if (units > MAX_UNITS_PER_ROW) { units = MAX_UNITS_PER_ROW; report.cappedRows++ }

    const brand = str(row.brand_name)
    const variants = variantSummary(row)
    const description = clip(variants ? `${name} — ${variants}` : name, 500)
    const descText = htmlToText(row.description)
    const notes = descText && descText.toLowerCase() !== name.toLowerCase() ? clip(descText, 500) : null
    const grams = findGrams(row)
    const { metal, karat, coating } = guessMetal([name, row.tags ?? null, row.handle ?? null, descText])
    const cost = money(row.supply_price) ?? 0
    const retail = money(row.retail_price)
    const listPrice = retail && retail > 0 ? retail : null

    // Validate once per product through the same schema the New Item form
    // uses, so an import can never write what a clerk could not.
    const parsed = inventoryItemCreateSchema.safeParse({
      sku: '',
      description,
      category: mapCategory(str(row.product_category), name, brand, variants),
      brand: brand ?? '',
      model: '',
      serial_number: '',
      metal: metal ?? '',
      karat: karat ?? '',
      weight_grams: grams ?? '',
      weight_dwt: grams ? round4(grams / GRAMS_PER_DWT) : '',
      condition: 'new',
      coating,
      finish: '',
      shelf_location: '',
      legacy_code: str(row.sku) ?? '',
      wholesale_price: '',
      cost_basis: cost,
      list_price: listPrice ?? '',
      source: 'new_stock',
      source_vendor: str(row.supplier_name) ?? '',
      acquired_at: acquiredAt,
      acquired_cost: cost,
      hold_until: '',
      location: 'case',
      status: 'available',
      notes: notes ?? '',
      staff_memo: '',
      tags: splitTags(row.tags),
      is_hidden_from_catalog: false,
    })
    if (!parsed.success) { report.skippedInvalid++; continue }
    const v = parsed.data

    let added = 0
    for (let n = 1; n <= units; n++) {
      const ref = `${productId}#${n}`
      if (existingRefs.has(ref)) { report.skippedExisting++; continue }
      records.push({
        tenant_id: tenantId,
        sku: '',
        sku_number: 0,
        description: v.description,
        category: v.category,
        brand: v.brand,
        metal: v.metal,
        karat: v.karat,
        weight_grams: v.weight_grams,
        weight_dwt: v.weight_dwt,
        condition: v.condition,
        coating: v.coating,
        legacy_code: v.legacy_code,
        cost_basis: v.cost_basis,
        list_price: v.list_price,
        source: v.source,
        source_vendor: v.source_vendor,
        acquired_at: v.acquired_at,
        acquired_cost: v.acquired_cost,
        location: v.location,
        status: v.status,
        notes: v.notes,
        tags: v.tags,
        is_hidden_from_catalog: v.is_hidden_from_catalog,
        import_source: LIGHTSPEED_SOURCE,
        import_ref: ref,
        created_by: createdBy,
        updated_by: createdBy,
      })
      added++
    }
    if (added === 0) continue

    report.toInsert += added
    report.productsImported++
    if (v.weight_grams == null) report.noWeight += added
    if (v.list_price == null) report.noPrice += added
    if (samples.length < 12) {
      samples.push({
        description: v.description,
        category: v.category,
        metal: v.metal,
        karat: v.karat,
        weight_grams: v.weight_grams,
        cost_basis: v.cost_basis,
        list_price: v.list_price,
        legacy_code: v.legacy_code,
        units: added,
      })
    }
  }

  return { records, report, samples }
}
