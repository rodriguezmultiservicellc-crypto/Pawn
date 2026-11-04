/**
 * Public quote document — the ONLY shape that reaches an unauthenticated
 * browser about a custom-piece quote (/q/<token>).
 *
 * The SECURITY DEFINER RPC `custom_quote_public(token)` (patches/0063)
 * already returns just these fields and never a cost; this shaper rebuilds
 * the object key by key from an allowlist so a future column cannot leak,
 * and the test locks the forbidden set (costs, margin, customer identity,
 * internal notes).
 */

import type { CustomPieceCategory, CustomQuoteLineKind } from '@/types/database-aliases'

export type PublicQuoteStatus =
  | 'draft'
  | 'sent'
  | 'accepted'
  | 'declined'
  | 'expired'
  | 'converted'

export type PublicQuoteLine = {
  kind: CustomQuoteLineKind
  label: string
  quantity: number
  price_total: number
}

export type PublicQuoteShop = {
  name: string
  logo_url: string | null
  phone: string | null
  public_slug: string | null
}

export type PublicQuote = {
  quote_number: string
  status: PublicQuoteStatus
  category: CustomPieceCategory
  description: string
  size: string | null
  price_total: number
  deposit_pct: number
  deposit_amount: number
  balance_due: number
  expires_on: string | null
  /** "Priced at $X/g on <date>" — null when the quote has no metal line. */
  spot_priced_at: string | null
  spot_price_per_gram: number | null
  spot_metal_label: string | null
  created_at: string
  accepted_at: string | null
  /** Empty unless the shop enabled the breakdown. Never carries a cost. */
  lines: PublicQuoteLine[]
  photo_path: string | null
  language: 'en' | 'es'
  shop: PublicQuoteShop
}

export const PUBLIC_QUOTE_FORBIDDEN_KEYS = [
  'id',
  'tenant_id',
  'customer_id',
  'customer',
  'customer_name',
  'customer_phone',
  'customer_email',
  'first_name',
  'last_name',
  'email',
  'address',
  'notes_internal',
  'margin_pct',
  'cost_total',
  'unit_cost',
  'unit_price',
  'price_locked',
  'inventory_item_id',
  'public_token',
  'repair_ticket_id',
  'created_by',
] as const

const STATUSES: ReadonlySet<string> = new Set([
  'draft',
  'sent',
  'accepted',
  'declined',
  'expired',
  'converted',
])

const KINDS: ReadonlySet<string> = new Set(['metal', 'wax', 'labor', 'stone', 'setting', 'extra'])

function num(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? Math.round(n * 10000) / 10000 : null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

function line(v: unknown): PublicQuoteLine | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const kind = str(o.kind)
  const label = str(o.label)
  const quantity = num(o.quantity)
  const price_total = num(o.price_total)
  if (!kind || !KINDS.has(kind) || !label || quantity == null || price_total == null) return null
  return { kind: kind as CustomQuoteLineKind, label, quantity, price_total }
}

export function shapePublicQuote(raw: unknown): PublicQuote | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const quote_number = str(o.quote_number)
  const status = str(o.status)
  const category = str(o.category) as CustomPieceCategory | null
  const description = str(o.description)
  const created_at = str(o.created_at)
  const price_total = num(o.price_total)
  if (!quote_number || !status || !STATUSES.has(status) || !category || !description || !created_at || price_total == null) {
    return null
  }

  const shopRaw = (o.shop ?? {}) as Record<string, unknown>
  const linesRaw = Array.isArray(o.lines) ? o.lines : []

  return {
    quote_number,
    status: status as PublicQuoteStatus,
    category,
    description,
    size: str(o.size),
    price_total,
    deposit_pct: num(o.deposit_pct) ?? 0,
    deposit_amount: num(o.deposit_amount) ?? 0,
    balance_due: num(o.balance_due) ?? 0,
    expires_on: str(o.expires_on),
    spot_priced_at: str(o.spot_priced_at),
    spot_price_per_gram: num(o.spot_price_per_gram),
    spot_metal_label: str(o.spot_metal_label),
    created_at,
    accepted_at: str(o.accepted_at),
    lines: linesRaw.map(line).filter((l): l is PublicQuoteLine => l != null),
    photo_path: str(o.photo_path),
    language: o.language === 'es' ? 'es' : 'en',
    shop: {
      name: str(shopRaw.name) ?? '',
      logo_url: str(shopRaw.logo_url),
      phone: str(shopRaw.phone),
      public_slug: str(shopRaw.public_slug),
    },
  }
}
