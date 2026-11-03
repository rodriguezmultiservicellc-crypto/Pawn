/**
 * Public tracking document — the ONLY shape that ever reaches an
 * unauthenticated browser about a repair ticket.
 *
 * The SECURITY DEFINER RPC `repair_public_ticket(token)` (patches/0061)
 * already returns just these fields, but the RPC is a trust boundary we
 * re-check here: `shapePublicTicket` rebuilds the object key by key from
 * an allowlist, so a future "helpful" column added to the RPC cannot leak
 * through to the page, and the test file locks the forbidden set.
 */

import type { RepairStageLite } from './stages'
import type { RepairStatus, ServiceType } from '@/types/database-aliases'

export type PublicTicketShop = {
  name: string
  logo_url: string | null
  phone: string | null
  /** Set only when the shop's public landing is enabled → "Visit our site" link. */
  public_slug: string | null
}

export type PublicTicket = {
  ticket_number: string
  service_type: ServiceType
  status: RepairStatus
  item_description: string
  promised_date: string | null
  quote_amount: number | null
  /** deposit + any payments applied so far */
  paid_total: number
  balance_due: number | null
  completed_at: string | null
  picked_up_at: string | null
  created_at: string
  stage: RepairStageLite | null
  stages: RepairStageLite[]
  /** Storage path inside repair-photos; the page signs it. Never a URL. */
  photo_path: string | null
  /** Customer's language — the only customer field that crosses. */
  language: 'en' | 'es'
  shop: PublicTicketShop
}

/**
 * Keys that must NEVER appear in a public document. Checked in tests
 * against both the shaper's output and this list's completeness.
 */
export const PUBLIC_TICKET_FORBIDDEN_KEYS = [
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
  'address1',
  'id_number',
  'notes_internal',
  'description',
  'assigned_to',
  'pickup_signature_path',
  'pickup_by_name',
  'pickup_id_check',
  'public_token',
] as const

function num(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? Math.round(n * 10000) / 10000 : null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

function stage(v: unknown): RepairStageLite | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const id = str(o.id)
  const name_en = str(o.name_en)
  const name_es = str(o.name_es)
  const percent = num(o.percent)
  const sort_order = num(o.sort_order)
  if (!id || !name_en || !name_es || percent == null || sort_order == null) return null
  return { id, name_en, name_es, percent, sort_order }
}

/** Rebuild the document from the RPC's JSON. Returns null on any shape failure. */
export function shapePublicTicket(raw: unknown): PublicTicket | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const ticket_number = str(o.ticket_number)
  const service_type = str(o.service_type) as ServiceType | null
  const status = str(o.status) as RepairStatus | null
  const item_description = str(o.item_description) ?? ''
  const created_at = str(o.created_at)
  if (!ticket_number || !service_type || !status || !created_at) return null

  const shopRaw = (o.shop ?? {}) as Record<string, unknown>
  const shop: PublicTicketShop = {
    name: str(shopRaw.name) ?? '',
    logo_url: str(shopRaw.logo_url),
    phone: str(shopRaw.phone),
    public_slug: str(shopRaw.public_slug),
  }

  const stagesRaw = Array.isArray(o.stages) ? o.stages : []
  const stages = stagesRaw
    .map(stage)
    .filter((s): s is RepairStageLite => s != null)
    .sort((a, b) => a.sort_order - b.sort_order)

  const deposit = num(o.deposit_amount) ?? 0
  const paid = num(o.paid_amount) ?? 0

  return {
    ticket_number,
    service_type,
    status,
    item_description,
    promised_date: str(o.promised_date),
    quote_amount: num(o.quote_amount),
    paid_total: Math.round((deposit + paid) * 10000) / 10000,
    balance_due: num(o.balance_due),
    completed_at: str(o.completed_at),
    picked_up_at: str(o.picked_up_at),
    created_at,
    stage: stage(o.stage),
    stages,
    photo_path: str(o.photo_path),
    language: o.language === 'es' ? 'es' : 'en',
    shop,
  }
}
