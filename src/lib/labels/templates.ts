/**
 * Tag templates — what a tag looks like and what it carries. Pure.
 *
 * A template is stock geometry (inches) + which fields print + how the
 * barcode is written. Tenants save their own rows in `label_templates`
 * (patches/0074); until they do, the built-ins below are used, so printing
 * works on day one with no setup.
 *
 * Geometry model:
 *   single — one printable rectangle (a plain label).
 *   split  — two equal printable wings with an unprinted gap between them
 *            (`gap_in`): rat-tail and barbell tags. The left wing carries
 *            the barcode, the right wing the text, so a folded tag shows
 *            code on one face and price on the other.
 *
 * The built-in sizes are starting points, not vendor specs: shops measure
 * their own stock and save a copy.
 */

import { z } from 'zod'

export const TAG_KINDS = ['inventory', 'collateral', 'repair'] as const
export type TagKind = (typeof TAG_KINDS)[number]

export const TAG_LAYOUTS = ['single', 'split'] as const
export type TagLayout = (typeof TAG_LAYOUTS)[number]

export const TAG_DPIS = [203, 300, 600] as const
export type TagDpi = (typeof TAG_DPIS)[number]

/** 'code' = the full SKU / ticket text; 'number' = digits only (shorter). */
export const BARCODE_PAYLOADS = ['code', 'number'] as const
export type BarcodePayload = (typeof BARCODE_PAYLOADS)[number]

export const TAG_FIELDS = [
  'price',
  'metal',
  'weight',
  'description',
  'stones',
  'cost_code',
  'shop_name',
  'due_date',
] as const
export type TagField = (typeof TAG_FIELDS)[number]

/** Which fields each kind can carry. Collateral never shows price or cost. */
export const FIELDS_BY_KIND: Record<TagKind, readonly TagField[]> = {
  inventory: ['price', 'metal', 'weight', 'description', 'stones', 'cost_code', 'shop_name'],
  collateral: ['metal', 'weight', 'description', 'due_date'],
  repair: ['description', 'due_date'],
}

export type TagFields = Partial<Record<TagField, boolean>>

export type TagTemplate = {
  /** null for a built-in that has never been saved by the tenant. */
  id: string | null
  name: string
  kind: TagKind
  width_in: number
  height_in: number
  layout: TagLayout
  gap_in: number
  dpi: TagDpi
  barcode_payload: BarcodePayload
  fields: TagFields
  is_default: boolean
}

export const tagTemplateInputSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    kind: z.enum(TAG_KINDS),
    width_in: z.coerce.number().min(0.5).max(6),
    height_in: z.coerce.number().min(0.25).max(6),
    layout: z.enum(TAG_LAYOUTS),
    gap_in: z.coerce.number().min(0).max(3),
    dpi: z.coerce.number().refine((n): n is TagDpi => (TAG_DPIS as readonly number[]).includes(n)),
    barcode_payload: z.enum(BARCODE_PAYLOADS),
    fields: z.partialRecord(z.enum(TAG_FIELDS), z.boolean()),
    is_default: z.boolean(),
  })
  .refine((v) => v.layout === 'single' || v.width_in - v.gap_in >= 0.5, {
    message: 'tag_wings_too_small',
    path: ['gap_in'],
  })

export type TagTemplateInput = z.infer<typeof tagTemplateInputSchema>

const ALL_INVENTORY: TagFields = {
  price: true,
  metal: true,
  weight: true,
  description: true,
  stones: true,
  cost_code: false,
  shop_name: false,
}

export const BUILTIN_TEMPLATES: readonly TagTemplate[] = [
  {
    id: null,
    name: 'Rat-tail tag',
    kind: 'inventory',
    width_in: 2.2,
    height_in: 0.5,
    layout: 'split',
    gap_in: 0,
    dpi: 203,
    barcode_payload: 'number',
    fields: ALL_INVENTORY,
    is_default: true,
  },
  {
    id: null,
    name: 'Barbell tag',
    kind: 'inventory',
    width_in: 2.2,
    height_in: 0.5,
    layout: 'split',
    gap_in: 0.6,
    dpi: 203,
    barcode_payload: 'number',
    fields: { ...ALL_INVENTORY, description: false },
    is_default: false,
  },
  {
    id: null,
    name: 'Rectangular label',
    kind: 'inventory',
    width_in: 1.5,
    height_in: 1,
    layout: 'single',
    gap_in: 0,
    dpi: 203,
    barcode_payload: 'code',
    fields: ALL_INVENTORY,
    is_default: false,
  },
  {
    id: null,
    name: 'Collateral label',
    kind: 'collateral',
    width_in: 2,
    height_in: 1,
    layout: 'single',
    gap_in: 0,
    dpi: 203,
    barcode_payload: 'code',
    fields: { metal: true, weight: true, description: true, due_date: true },
    is_default: true,
  },
  {
    id: null,
    name: 'Repair envelope label',
    kind: 'repair',
    width_in: 2,
    height_in: 1,
    layout: 'single',
    gap_in: 0,
    dpi: 203,
    barcode_payload: 'code',
    fields: { description: true, due_date: true },
    is_default: true,
  },
]

/**
 * The template to use for a kind: the explicitly requested one, else the
 * tenant's default for that kind, else the first tenant row of that kind,
 * else the built-in default.
 */
export function pickTemplate(
  saved: readonly TagTemplate[],
  kind: TagKind,
  requestedId?: string | null,
): TagTemplate {
  if (requestedId) {
    const hit =
      saved.find((t) => t.id === requestedId && t.kind === kind) ??
      BUILTIN_TEMPLATES.find((t) => t.kind === kind && templateKey(t) === requestedId)
    if (hit) return hit
  }
  const ofKind = saved.filter((t) => t.kind === kind)
  const builtin =
    BUILTIN_TEMPLATES.find((t) => t.kind === kind && t.is_default) ??
    BUILTIN_TEMPLATES.find((t) => t.kind === kind)!
  return ofKind.find((t) => t.is_default) ?? ofKind[0] ?? builtin
}

/** Stable key for a template: its id, or `builtin:<name>` for a built-in. */
export function templateKey(t: Pick<TagTemplate, 'id' | 'name'>): string {
  return t.id ?? `builtin:${t.name}`
}

export type TemplateChoice = { key: string; name: string; isDefault: boolean; builtin: boolean }

/**
 * What the print menu offers for a kind: the tenant's saved templates,
 * then the built-ins. Exactly one choice is marked default — the one
 * pickTemplate() would use with no request.
 */
export function templateChoices(saved: readonly TagTemplate[], kind: TagKind): TemplateChoice[] {
  const effective = templateKey(pickTemplate(saved, kind))
  const list = [...saved.filter((t) => t.kind === kind), ...BUILTIN_TEMPLATES.filter((t) => t.kind === kind)]
  return list.map((t) => ({ key: templateKey(t), name: t.name, isDefault: templateKey(t) === effective, builtin: t.id === null }))
}

/** Printable wings as {x, w} in inches. One entry for 'single'. */
export function tagPanels(t: Pick<TagTemplate, 'width_in' | 'layout' | 'gap_in'>): Array<{ x: number; w: number }> {
  if (t.layout === 'single') return [{ x: 0, w: t.width_in }]
  const w = (t.width_in - t.gap_in) / 2
  return [
    { x: 0, w },
    { x: w + t.gap_in, w },
  ]
}

/** Coerce a DB row's jsonb `fields` to the known flags only. */
export function normalizeFields(kind: TagKind, raw: unknown): TagFields {
  const out: TagFields = {}
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  for (const f of FIELDS_BY_KIND[kind]) out[f] = obj[f] === true
  return out
}
