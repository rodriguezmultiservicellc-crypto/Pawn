'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { REPAIR_PHOTOS_BUCKET, uploadToBucket } from '@/lib/supabase/storage'
import {
  ALLOWED_REPAIR_PHOTO_MIME_TYPES,
  MAX_REPAIR_PHOTO_BYTES,
} from '@/lib/validations/repair'
import { extensionForUpload as pickExt, resolveUploadMime } from '@/lib/uploads/mime'
import { prepareUpload } from '@/lib/uploads/convert'
import { logAudit } from '@/lib/audit'
import { dispatchMessage } from '@/lib/comms/dispatch'
import { formatMoney } from '@/lib/format/money'
import { loadTenantRules } from '@/lib/jurisdictions/load'
import { todayInTimezone } from '@/lib/jurisdictions/rules'
import { r4 } from '@/lib/money'
import {
  quoteSaveSchema,
  quoteStatusActionSchema,
  type QuoteLineInput,
} from '@/lib/validations/custom-quote'
import {
  applyTargetMargin,
  depositSplit,
  expiryDate,
  lineTotals,
  marginBelowMinimum,
  quoteTotals,
} from '@/lib/custom-quotes/math'
import { loadCustomQuoteSettings } from '@/lib/custom-quotes/settings'
import { resolveMetalSpot } from '@/lib/custom-quotes/spot'
import { loadQuoteDetail, type QuoteDetailView } from '@/lib/custom-quotes/load'
import { quoteUrl } from '@/lib/custom-quotes/links'
import type { CustomQuoteStatus, TenantRole } from '@/types/database-aliases'
import type { Json } from '@/types/database'

/**
 * Custom-piece quotes — server actions (brief Phase 2, patches/0063).
 *
 * Money discipline: the browser sends lines; this file RECOMPUTES every
 * total, re-freezes metal lines at the live spot, re-applies the target
 * margin to unlocked lines and refuses a quote under the tenant's minimum
 * margin. The DB trigger then freezes everything once the quote leaves
 * draft/sent.
 */

export type QuoteActionState = {
  ok?: boolean
  /** Translated through t.quotes.errors[code] when it matches. */
  error?: string
  fieldErrors?: Record<string, string>
  /** New quote id after create / duplicate (the form redirects to it). */
  quoteId?: string
  link?: string | null
}

const STAFF_REPAIR_ROLES: ReadonlyArray<TenantRole> = [
  'owner',
  'manager',
  'chain_admin',
  'pawn_clerk',
  'repair_tech',
]

async function scope() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_repair')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  if (!tenant?.has_repair) redirect('/dashboard')
  const { supabase, userId } = await requireRoleInTenant(ctx.tenantId, STAFF_REPAIR_ROLES)
  return { ctx, supabase, userId, tenantId: ctx.tenantId }
}

async function shopToday(tenantId: string): Promise<string> {
  const rules = await loadTenantRules(createAdminClient(), tenantId)
  return todayInTimezone(rules.timezone)
}

function revalidateQuote(id?: string) {
  revalidatePath('/repair/quotes')
  if (id) revalidatePath(`/repair/quotes/${id}`)
}

// ── Save (create / update) ────────────────────────────────────────────────

type PricedLine = QuoteLineInput & {
  cost_total: number
  price_total: number
  position: number
}

/**
 * Server-side pricing pass. Returns the lines as they will be stored plus
 * the frozen spot summary, or an error code.
 */
async function priceLines(
  raw: QuoteLineInput[],
  marginPct: number,
): Promise<
  | { ok: true; lines: PricedLine[]; spot: { pricePerGram: number; fetchedAt: string; label: string } | null }
  | { ok: false; error: string }
> {
  let spotSummary: { pricePerGram: number; fetchedAt: string; label: string } | null = null
  const withSpot: QuoteLineInput[] = []
  for (const l of raw) {
    if (l.kind !== 'metal') {
      withSpot.push(l)
      continue
    }
    const metal = l.details.metal_type
    if (!metal) return { ok: false, error: 'metal_required' }
    const snap = await resolveMetalSpot({ metal, karat: l.details.karat ?? null })
    if (!snap) return { ok: false, error: 'no_spot_price' }
    if (!spotSummary) {
      spotSummary = { pricePerGram: snap.pricePerGram, fetchedAt: snap.fetchedAt, label: snap.label }
    }
    withSpot.push({
      ...l,
      // Frozen: the line's cost is today's spot per gram, whatever the form said.
      unit_cost: snap.pricePerGram,
      details: {
        ...l.details,
        spot_per_gram: snap.pricePerGram,
        spot_fetched_at: snap.fetchedAt,
        spot_source: snap.source,
        spot_label: snap.label,
      },
    })
  }

  const priced = applyTargetMargin(
    withSpot.map((l) => ({ ...l, price_locked: l.price_locked })),
    marginPct,
  )
  const lines: PricedLine[] = priced.map((l, i) => {
    const t = lineTotals(l)
    return { ...l, cost_total: t.cost_total, price_total: t.price_total, position: i }
  })
  return { ok: true, lines, spot: spotSummary }
}

export async function saveQuoteAction(
  _prev: QuoteActionState,
  formData: FormData,
): Promise<QuoteActionState> {
  const { supabase, userId, tenantId } = await scope()

  let payload: unknown
  try {
    payload = JSON.parse(String(formData.get('payload') ?? '{}'))
  } catch {
    return { error: 'invalid' }
  }
  const parsed = quoteSaveSchema.safeParse(payload)
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.')
      if (path && !fieldErrors[path]) fieldErrors[path] = issue.message
    }
    return { error: 'invalid', fieldErrors }
  }
  const v = parsed.data
  const quoteId = String(formData.get('quote_id') ?? '').trim() || null

  const admin = createAdminClient()
  const settings = await loadCustomQuoteSettings(admin, tenantId)

  // Margin floor is the manager's, not the browser's.
  if (marginBelowMinimum(v.margin_pct, settings.minMarginPct)) {
    return { error: 'margin_below_minimum' }
  }

  // Customer must be in this tenant.
  const { data: customer } = await supabase
    .from('customers')
    .select('id')
    .eq('id', v.customer_id)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!customer) return { error: 'customer_not_found' }

  // Stones picked from inventory must be this tenant's.
  const invIds = v.lines.map((l) => l.inventory_item_id).filter((x): x is string => !!x)
  if (invIds.length > 0) {
    const { data: inv } = await supabase
      .from('inventory_items')
      .select('id')
      .eq('tenant_id', tenantId)
      .in('id', invIds)
    if ((inv ?? []).length !== new Set(invIds).size) return { error: 'inventory_item_not_found' }
  }

  const priced = await priceLines(v.lines, v.margin_pct)
  if (!priced.ok) return { error: priced.error }

  const totals = quoteTotals(priced.lines)
  if (totals.cost > 0 && marginBelowMinimum(totals.marginPct, settings.minMarginPct)) {
    // A hand-typed (locked) price dragged the whole quote under the floor.
    return { error: 'margin_below_minimum' }
  }
  const { deposit, balance } = depositSplit(totals.price, v.deposit_pct)

  const today = await shopToday(tenantId)
  const expiresOn = v.expires_on ?? expiryDate(today, settings.expiryDays)

  // Existing quote: must be editable.
  let existing: QuoteDetailView | null = null
  if (quoteId) {
    existing = await loadQuoteDetail({ client: supabase, tenantId, quoteId, today })
    if (!existing) return { error: 'not_found' }
    if (existing.status !== 'draft' && existing.status !== 'sent') return { error: 'locked' }
  }

  const header = {
    customer_id: v.customer_id,
    category: v.category,
    description: v.description,
    size: v.size,
    margin_pct: v.margin_pct,
    cost_total: totals.cost,
    price_total: totals.price,
    spot_priced_at: priced.spot?.fetchedAt ?? null,
    spot_price_per_gram: priced.spot?.pricePerGram ?? null,
    spot_metal_label: priced.spot?.label ?? null,
    deposit_pct: v.deposit_pct,
    deposit_amount: deposit,
    balance_due: balance,
    payment_method: v.payment_method ?? null,
    expires_on: expiresOn,
    notes_internal: v.notes_internal,
    updated_by: userId,
  }

  let id = quoteId
  if (id) {
    const { error } = await supabase
      .from('custom_quotes')
      .update(header)
      .eq('id', id)
      .eq('tenant_id', tenantId)
    if (error) return { error: error.message.includes('custom_quote_locked') ? 'locked' : error.message }
    // Replace lines wholesale — a quote is edited as one document.
    const { error: delErr } = await supabase
      .from('custom_quote_lines')
      .delete()
      .eq('quote_id', id)
      .eq('tenant_id', tenantId)
    if (delErr) return { error: delErr.message }
  } else {
    const { data, error } = await supabase
      .from('custom_quotes')
      .insert({ tenant_id: tenantId, ...header, created_by: userId })
      .select('id')
      .single()
    if (error || !data) return { error: error?.message ?? 'insert_failed' }
    id = data.id
  }

  const { error: linesErr } = await supabase.from('custom_quote_lines').insert(
    priced.lines.map((l) => ({
      quote_id: id!,
      tenant_id: tenantId,
      kind: l.kind,
      position: l.position,
      label: l.label,
      quantity: l.quantity,
      unit_cost: l.unit_cost,
      unit_price: l.unit_price,
      cost_total: l.cost_total,
      price_total: l.price_total,
      price_locked: l.price_locked,
      details: l.details as Json,
      inventory_item_id: l.inventory_item_id ?? null,
    })),
  )
  if (linesErr) return { error: linesErr.message }

  // Reference photo (optional; one).
  const photo = formData.get('reference_photo')
  if (photo instanceof File && photo.size > 0 && photo.size <= MAX_REPAIR_PHOTO_BYTES) {
    const mime = resolveUploadMime(photo)
    if (ALLOWED_REPAIR_PHOTO_MIME_TYPES.includes(mime as never)) {
      try {
        const up = await prepareUpload(photo, mime)
        const ext = pickExt(up.mime, up.filename)
        const path = `${tenantId}/quotes/${id}/reference/${crypto.randomUUID()}.${ext}`
        await uploadToBucket({ bucket: REPAIR_PHOTOS_BUCKET, path, body: up.body, contentType: up.mime })
        await supabase
          .from('custom_quotes')
          .update({ reference_photo_path: path })
          .eq('id', id)
          .eq('tenant_id', tenantId)
      } catch (err) {
        console.error('[quotes.save] reference photo upload failed', err)
      }
    }
  }

  await logAudit({
    tenantId,
    userId,
    action: quoteId ? 'custom_quote_update' : 'custom_quote_create',
    tableName: 'custom_quotes',
    recordId: id!,
    changes: {
      category: v.category,
      customer_id: v.customer_id,
      margin_pct: v.margin_pct,
      cost_total: totals.cost,
      price_total: totals.price,
      deposit_amount: deposit,
      lines: priced.lines.length,
      spot_per_gram: priced.spot?.pricePerGram ?? null,
    },
  })

  revalidateQuote(id!)
  return { ok: true, quoteId: id! }
}

// ── Status transitions ────────────────────────────────────────────────────

const TERMINAL: ReadonlySet<CustomQuoteStatus> = new Set(['declined', 'expired', 'converted', 'voided'])

export async function quoteStatusAction(formData: FormData): Promise<QuoteActionState> {
  const parsed = quoteStatusActionSchema.safeParse({
    quote_id: formData.get('quote_id'),
    action: formData.get('action'),
  })
  if (!parsed.success) return { error: 'invalid' }
  const { quote_id, action } = parsed.data

  const { supabase, userId, tenantId } = await scope()
  const today = await shopToday(tenantId)
  const q = await loadQuoteDetail({ client: supabase, tenantId, quoteId: quote_id, today })
  if (!q) return { error: 'not_found' }

  if (action === 'duplicate') return duplicateQuote(q, { supabase, userId, tenantId })
  if (action === 'convert') return convertQuote(q, { supabase, userId, tenantId })

  if (TERMINAL.has(q.status)) return { error: 'terminal' }
  const now = new Date().toISOString()
  let patch: Record<string, unknown>
  let audit: 'custom_quote_send' | 'custom_quote_accept' | 'custom_quote_decline' | 'custom_quote_void'
  switch (action) {
    case 'send':
      if (q.status !== 'draft') return { error: 'illegal_transition' }
      patch = { status: 'sent', sent_at: now }
      audit = 'custom_quote_send'
      break
    case 'accept':
      if (q.effective_status === 'expired') return { error: 'expired' }
      if (q.status !== 'draft' && q.status !== 'sent') return { error: 'illegal_transition' }
      patch = { status: 'accepted', accepted_at: now }
      audit = 'custom_quote_accept'
      break
    case 'decline':
      if (q.status !== 'draft' && q.status !== 'sent') return { error: 'illegal_transition' }
      patch = { status: 'declined', declined_at: now }
      audit = 'custom_quote_decline'
      break
    case 'void':
      patch = { status: 'voided', voided_at: now }
      audit = 'custom_quote_void'
      break
    default:
      return { error: 'invalid' }
  }

  const { error } = await supabase
    .from('custom_quotes')
    .update({ ...patch, updated_by: userId })
    .eq('id', q.id)
    .eq('tenant_id', tenantId)
  if (error) return { error: error.message }

  await logAudit({
    tenantId,
    userId,
    action: audit,
    tableName: 'custom_quotes',
    recordId: q.id,
    changes: { from: q.status, to: patch.status, quote_number: q.quote_number, price_total: q.price_total },
  })
  revalidateQuote(q.id)
  return { ok: true }
}

type Scope = { supabase: Awaited<ReturnType<typeof scope>>['supabase']; userId: string; tenantId: string }

/** New DRAFT from an existing quote; metal re-prices at today's spot on save. */
async function duplicateQuote(q: QuoteDetailView, s: Scope): Promise<QuoteActionState> {
  const { data, error } = await s.supabase
    .from('custom_quotes')
    .insert({
      tenant_id: s.tenantId,
      customer_id: q.customer_id,
      category: q.category,
      description: q.description,
      size: q.size,
      reference_photo_path: q.reference_photo_path,
      margin_pct: q.margin_pct,
      cost_total: q.cost_total,
      price_total: q.price_total,
      spot_priced_at: q.spot_priced_at,
      spot_price_per_gram: q.spot_price_per_gram,
      spot_metal_label: q.spot_metal_label,
      deposit_pct: q.deposit_pct,
      deposit_amount: q.deposit_amount,
      balance_due: q.balance_due,
      payment_method: q.payment_method as never,
      notes_internal: q.notes_internal,
      created_by: s.userId,
      updated_by: s.userId,
    })
    .select('id')
    .single()
  if (error || !data) return { error: error?.message ?? 'insert_failed' }
  if (q.lines.length > 0) {
    const { error: lErr } = await s.supabase.from('custom_quote_lines').insert(
      q.lines.map((l) => ({
        quote_id: data.id,
        tenant_id: s.tenantId,
        kind: l.kind,
        position: l.position,
        label: l.label,
        quantity: l.quantity,
        unit_cost: l.unit_cost,
        unit_price: l.unit_price,
        cost_total: l.cost_total,
        price_total: l.price_total,
        price_locked: l.price_locked,
        details: l.details as Json,
        inventory_item_id: l.inventory_item_id,
      })),
    )
    if (lErr) return { error: lErr.message }
  }
  await logAudit({
    tenantId: s.tenantId,
    userId: s.userId,
    action: 'custom_quote_duplicate',
    tableName: 'custom_quotes',
    recordId: data.id,
    changes: { from_quote_id: q.id, from_quote_number: q.quote_number },
  })
  revalidateQuote(data.id)
  return { ok: true, quoteId: data.id }
}

/**
 * One tap: accepted quote → repair ticket (service_type 'custom').
 *
 * The ticket is born QUOTED-AND-APPROVED (status awaiting_approval with
 * quote_set_at + quote_approved_at stamped) so the Phase 1 stage lands on
 * "Design approved" and the next staff move is assigning a jeweler. Cost
 * lines become parts rows (COGS at pickup), stone lines become ticket
 * stones, the reference photo carries over, and the DEPOSIT is NOT written
 * here — it is collected through the ticket's existing "Collect deposit"
 * flow, which records the tender and the event the same way every other
 * repair deposit is recorded.
 */
async function convertQuote(q: QuoteDetailView, s: Scope): Promise<QuoteActionState> {
  if (q.status !== 'accepted') return { error: 'accept_first' }
  if (q.repair_ticket_id) return { error: 'already_converted' }
  const now = new Date().toISOString()

  const metalLine = q.lines.find((l) => l.kind === 'metal')
  const details = (metalLine?.details ?? {}) as { karat?: string; metal_type?: string }
  const title = `${categoryWord(q.category)}: ${q.description}`.slice(0, 200)
  const itemDescription = [q.description, q.size ? `Size ${q.size}` : null].filter(Boolean).join(' · ')
  const workNeeded = q.lines
    .map((l) => `${l.label} × ${trimNum(l.quantity)}`)
    .join('\n')

  const { data: ticket, error: tErr } = await s.supabase
    .from('repair_tickets')
    .insert({
      tenant_id: s.tenantId,
      customer_id: q.customer_id,
      service_type: 'custom',
      title,
      description: `From quote ${q.quote_number}`,
      item_description: itemDescription,
      quote_amount: q.price_total,
      quote_set_at: now,
      quote_approved_at: now,
      balance_due: q.price_total,
      status: 'awaiting_approval',
      notes_internal: q.notes_internal,
      created_by: s.userId,
      updated_by: s.userId,
    })
    .select('id, ticket_number')
    .single()
  if (tErr || !ticket) return { error: tErr?.message ?? 'insert_failed' }

  await s.supabase.from('repair_ticket_line_items').insert({
    ticket_id: ticket.id,
    tenant_id: s.tenantId,
    line_index: 1,
    item_type: q.category,
    karat: details.karat ?? null,
    weight_grams: metalLine ? metalLine.quantity : null,
    dimension: q.size,
    title,
    service_type: 'custom',
    work_needed: workNeeded,
  })

  // Stones → ticket stones (shop-supplied; inventory link when picked).
  const stones = q.lines.filter((l) => l.kind === 'stone')
  if (stones.length > 0) {
    await s.supabase.from('repair_ticket_stones').insert(
      stones.map((l, i) => ({
        ticket_id: ticket.id,
        tenant_id: s.tenantId,
        stone_index: i + 1,
        stone_type: l.label.slice(0, 80),
        source: 'shop_supplied',
        shop_inventory_item_id: l.inventory_item_id,
        notes: `Qty ${trimNum(l.quantity)} · from quote ${q.quote_number}`,
      })),
    )
  }

  // Cost-bearing lines → parts (COGS). Pure-price lines carry no cost.
  const parts = q.lines.filter((l) => l.cost_total > 0)
  if (parts.length > 0) {
    await s.supabase.from('repair_ticket_items').insert(
      parts.map((l) => ({
        ticket_id: ticket.id,
        tenant_id: s.tenantId,
        inventory_item_id: l.inventory_item_id,
        description: l.label.slice(0, 200),
        quantity: l.quantity,
        unit_cost: l.unit_cost,
        total_cost: l.cost_total,
        notes: `From quote ${q.quote_number}`,
      })),
    )
  }

  if (q.reference_photo_path) {
    await s.supabase.from('repair_ticket_photos').insert({
      ticket_id: ticket.id,
      tenant_id: s.tenantId,
      storage_path: q.reference_photo_path,
      kind: 'reference',
      position: 0,
      uploaded_by: s.userId,
    })
  }

  await s.supabase.from('repair_ticket_events').insert([
    { ticket_id: ticket.id, tenant_id: s.tenantId, event_type: 'intake', new_status: 'intake', notes: `Created from quote ${q.quote_number}`, performed_by: s.userId },
    { ticket_id: ticket.id, tenant_id: s.tenantId, event_type: 'quote_set', new_status: 'quoted', amount: q.price_total, performed_by: s.userId },
    { ticket_id: ticket.id, tenant_id: s.tenantId, event_type: 'approved', new_status: 'awaiting_approval', amount: q.price_total, notes: q.deposit_amount > 0 ? `Deposit expected ${formatMoney(q.deposit_amount)} (${Math.round(q.deposit_pct * 100)}%) — collect via "Collect deposit"` : null, performed_by: s.userId },
  ])

  const { error: qErr } = await s.supabase
    .from('custom_quotes')
    .update({ status: 'converted', converted_at: now, repair_ticket_id: ticket.id, updated_by: s.userId })
    .eq('id', q.id)
    .eq('tenant_id', s.tenantId)
  if (qErr) return { error: qErr.message }

  await logAudit({
    tenantId: s.tenantId,
    userId: s.userId,
    action: 'custom_quote_convert',
    tableName: 'custom_quotes',
    recordId: q.id,
    changes: { quote_number: q.quote_number, repair_ticket_id: ticket.id, ticket_number: ticket.ticket_number, price_total: q.price_total, deposit_expected: q.deposit_amount },
  })
  await logAudit({
    tenantId: s.tenantId,
    userId: s.userId,
    action: 'create',
    tableName: 'repair_tickets',
    recordId: ticket.id,
    changes: { ticket_number: ticket.ticket_number, service_type: 'custom', from_quote: q.quote_number, quote_amount: q.price_total },
  })

  revalidateQuote(q.id)
  revalidatePath('/repair')
  revalidatePath('/repair/board')
  redirect(`/repair/${ticket.id}`)
}

function categoryWord(c: string): string {
  return c.charAt(0).toUpperCase() + c.slice(1)
}

function trimNum(n: number): string {
  return String(r4(n))
}

// ── Public link ───────────────────────────────────────────────────────────

export async function quoteLinkAction(formData: FormData): Promise<QuoteActionState> {
  const quoteId = String(formData.get('quote_id') ?? '')
  const op = String(formData.get('op') ?? '')
  const { supabase, userId, tenantId } = await scope()
  const today = await shopToday(tenantId)
  const q = await loadQuoteDetail({ client: supabase, tenantId, quoteId, today })
  if (!q) return { error: 'not_found' }

  if (op === 'regenerate' || op === 'revoke') {
    const token = op === 'regenerate' ? crypto.randomUUID().replace(/-/g, '') : null
    const { error } = await supabase
      .from('custom_quotes')
      .update({
        public_token: token,
        public_token_created_at: token ? new Date().toISOString() : null,
        updated_by: userId,
      })
      .eq('id', q.id)
      .eq('tenant_id', tenantId)
    if (error) return { error: error.message }
    await logAudit({
      tenantId,
      userId,
      action: op === 'regenerate' ? 'custom_quote_link_regenerate' : 'custom_quote_link_revoke',
      tableName: 'custom_quotes',
      recordId: q.id,
      changes: { had_link: q.public_token != null },
    })
    revalidateQuote(q.id)
    return { ok: true, link: quoteUrl(token) }
  }

  if (op === 'send') {
    const link = quoteUrl(q.public_token)
    if (!link) return { error: 'link_revoked' }
    const res = await dispatchMessage({
      tenantId,
      customerId: q.customer_id,
      kind: 'custom_quote_link',
      channelOverride: 'sms',
      vars: { quote_number: q.quote_number, amount: formatMoney(q.price_total), quote_link: link },
    })
    if (!res.ok) return { error: res.reason }
    // A quote the customer has received is "sent".
    if (q.status === 'draft') {
      await supabase
        .from('custom_quotes')
        .update({ status: 'sent', sent_at: new Date().toISOString(), updated_by: userId })
        .eq('id', q.id)
        .eq('tenant_id', tenantId)
    }
    await logAudit({
      tenantId,
      userId,
      action: 'custom_quote_link_send',
      tableName: 'custom_quotes',
      recordId: q.id,
      changes: { channel: res.channel, message_log_id: res.messageLogId },
    })
    revalidateQuote(q.id)
    return { ok: true, link }
  }

  return { error: 'invalid' }
}
