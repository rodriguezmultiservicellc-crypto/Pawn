'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import {
  layawayCreateSchema,
  saleCreateSchema,
  type SaleItemInput,
} from '@/lib/validations/pos'
import { logAudit } from '@/lib/audit'
import { externalCardSchema, type ExternalCard } from '@/lib/pos/card'
import {
  afterSaleCompleted,
  layawayCreate,
  posErrorKey,
  saleAddExternalCard,
  saleAddPayment,
  saleComplete,
  saleCreate,
  type SaleLineInput,
} from '@/lib/pos/money'
import type { PaymentMethod } from '@/types/database-aliases'

/**
 * Create-sale + create-layaway actions.
 *
 * Flow:
 *   - retail   : insert sale (status='open'), insert sale_items, flip
 *                inventory_items.status='sold' for items linked to inventory.
 *                Redirect to /pos/sales/[id] for the cashier to add payment.
 *   - layaway  : insert sale (sale_kind='layaway'), insert sale_items, flip
 *                inventory_items.status='held' (NOT 'sold'). Insert layaway
 *                row with scheduling. If down_payment > 0 also insert a
 *                sale_payment + a layaway_payment for the down payment.
 *                Redirect to /pos/layaways/[id].
 */

const STAFF_ROLES = [
  'owner',
  'manager',
  'pawn_clerk',
  'chain_admin',
] as const

export type CreateSaleResult = {
  error?: string
  fieldErrors?: Record<string, string>
  redirectTo?: string
  /** Cash sale paid and completed: stay on New sale with an empty cart. */
  completed?: { saleId: string; saleNumber: string | null; total: number; tender: 'cash' | 'card' }
}

type IncomingItem = {
  inventory_item_id: string | null
  description: string
  quantity: string
  unit_price: string
  line_discount: string
  position: string
}

function readItems(fd: FormData): IncomingItem[] {
  const countRaw = fd.get('items_count')
  const count = Math.max(0, Math.min(200, parseInt(String(countRaw ?? '0'), 10) || 0))
  const out: IncomingItem[] = []
  for (let i = 0; i < count; i++) {
    out.push({
      inventory_item_id:
        (fd.get(`item_${i}_inventory_item_id`) as string | null) || null,
      description: String(fd.get(`item_${i}_description`) ?? ''),
      quantity: String(fd.get(`item_${i}_quantity`) ?? '1'),
      unit_price: String(fd.get(`item_${i}_unit_price`) ?? '0'),
      line_discount: String(fd.get(`item_${i}_line_discount`) ?? '0'),
      position: String(i),
    })
  }
  return out
}

// ── Create sale (retail OR layaway) ────────────────────────────────────────

export async function createSaleAction(
  formData: FormData,
): Promise<CreateSaleResult> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_retail')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  if (!tenant?.has_retail) return { error: 'notAuthorized' }

  const { supabase, userId } = await requireRoleInTenant(
    ctx.tenantId,
    STAFF_ROLES,
  )

  const tenantId = ctx.tenantId

  // Verify open register session — sales must be tied to one.
  const { data: openSession } = await supabase
    .from('register_sessions')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('status', 'open')
    .is('deleted_at', null)
    .maybeSingle()
  if (!openSession) return { error: 'noOpenSession' }

  const kind = String(formData.get('sale_kind') ?? 'retail')
  const isLayaway = kind === 'layaway'
  const items = readItems(formData)

  if (isLayaway) {
    return createLayawayInternal({
      formData,
      items,
      userId,
      tenantId,
      registerSessionId: openSession.id,
    })
  }

  // ── Retail sale ──
  const parsed = saleCreateSchema.safeParse({
    customer_id: formData.get('customer_id'),
    tax_rate: formData.get('tax_rate'),
    discount_amount: formData.get('discount_amount'),
    notes: formData.get('notes'),
    items,
  })
  if (!parsed.success) {
    return { error: 'validationFailed' }
  }
  const v = parsed.data

  // Card = a card machine slip (patches/0085). Checked BEFORE the sale is
  // written, so a typo never leaves an unpaid sale behind.
  let tender: CounterTender = { kind: 'cash' }
  if (formData.get('tender') === 'card') {
    const card = externalCardSchema.safeParse({
      last4: formData.get('card_last4') ?? '',
      brand: formData.get('card_brand') ?? '',
      auth_code: formData.get('card_auth_code'),
    })
    if (!card.success) return { error: 'cardDetailsInvalid' }
    tender = { kind: 'card', card: card.data }
  }

  return persistSale({
    userId,
    tenantId,
    registerSessionId: openSession.id,
    customerId: v.customer_id,
    items: v.items,
    taxRate: v.tax_rate,
    discountAmount: v.discount_amount,
    notes: v.notes,
    tender,
  })
}

// ── Create layaway (called via createSaleAction with sale_kind='layaway') ──

async function createLayawayInternal(args: {
  formData: FormData
  items: IncomingItem[]
  userId: string
  tenantId: string
  registerSessionId: string
}): Promise<CreateSaleResult> {
  const parsed = layawayCreateSchema.safeParse({
    customer_id: args.formData.get('customer_id'),
    tax_rate: args.formData.get('tax_rate'),
    discount_amount: args.formData.get('discount_amount'),
    schedule_kind: args.formData.get('schedule_kind') ?? 'weekly',
    down_payment: args.formData.get('down_payment'),
    down_payment_method:
      args.formData.get('down_payment_method') ?? 'cash',
    first_payment_due: args.formData.get('first_payment_due'),
    final_due_date: args.formData.get('final_due_date'),
    cancellation_fee_pct: args.formData.get('cancellation_fee_pct'),
    notes: args.formData.get('notes'),
    items: args.items,
  })
  if (!parsed.success) {
    return { error: 'customerRequiredForLayaway' }
  }
  const v = parsed.data
  if (v.items.length === 0) return { error: 'cartEmpty' }

  // Sale, lines, stock hold, layaway row and down payment in one database
  // transaction (patches/0076). A down payment at the layaway counter is
  // money in hand — a card here is run on the shop's own terminal, so it
  // counts now; there is no PaymentIntent waiting to settle.
  const r = await layawayCreate({
    tenantId: args.tenantId,
    userId: args.userId,
    registerSessionId: args.registerSessionId,
    customerId: v.customer_id,
    taxRate: v.tax_rate,
    discount: v.discount_amount,
    notes: v.notes,
    items: toLines(v.items),
    scheduleKind: v.schedule_kind,
    downPayment: v.down_payment,
    downMethod: v.down_payment_method as PaymentMethod,
    firstPaymentDue: v.first_payment_due,
    finalDueDate: v.final_due_date,
    cancellationFeePct: v.cancellation_fee_pct,
  })
  if (!r.ok) return { error: posErrorKey(r.error) }

  await logAudit({
    tenantId: args.tenantId,
    userId: args.userId,
    action: 'layaway_create',
    tableName: 'layaways',
    recordId: r.data.layawayId,
    changes: {
      layaway_number: r.data.layawayNumber,
      sale_id: r.data.saleId,
      total_due: r.data.total,
      down_payment: v.down_payment,
      schedule_kind: v.schedule_kind,
      completed: r.data.completed,
    },
  })
  if (r.data.completed) await afterSaleCompleted({ tenantId: args.tenantId, saleId: r.data.saleId })

  revalidatePath('/pos')
  revalidatePath('/pos/layaways')
  return { redirectTo: `/pos/layaways/${r.data.layawayId}` }
}

function toLines(items: SaleItemInput[]): SaleLineInput[] {
  return items.map((it) => ({
    inventory_item_id: it.inventory_item_id,
    description: it.description,
    quantity: it.quantity,
    unit_price: it.unit_price,
    line_discount: it.line_discount,
  }))
}

// ── Retail sale: one database transaction (patches/0076 sale_create) ───────
// Totals are computed in cents by the database; every linked piece is
// row-locked and must still be available, so two registers cannot sell the
// same item (REVIEW-2026-11-11 finding 13).

async function persistSale(args: {
  userId: string
  tenantId: string
  registerSessionId: string
  customerId: string | null
  items: SaleItemInput[]
  taxRate: number
  discountAmount: number
  notes: string | null
  /** Taken at the counter: cash, or a card run on the shop's card machine. */
  tender: CounterTender
}): Promise<CreateSaleResult> {
  if (args.items.length === 0) return { error: 'cartEmpty' }

  const r = await saleCreate({
    tenantId: args.tenantId,
    userId: args.userId,
    registerSessionId: args.registerSessionId,
    customerId: args.customerId,
    taxRate: args.taxRate,
    discount: args.discountAmount,
    notes: args.notes,
    items: toLines(args.items),
  })
  if (!r.ok) return { error: posErrorKey(r.error) }

  await logAudit({
    tenantId: args.tenantId,
    userId: args.userId,
    action: 'sale_create',
    tableName: 'sales',
    recordId: r.data.saleId,
    changes: {
      sale_number: r.data.saleNumber,
      sale_kind: 'retail',
      customer_id: args.customerId,
      total: r.data.total,
      item_count: args.items.length,
    },
  })

  const settled = await settleAtCounter(args, r.data.saleId, r.data.total, args.tender)

  revalidatePath('/pos')
  revalidatePath('/pos/sales')
  // Done at the counter → ready for the next customer. A step that refused
  // leaves the sale open; the clerk finishes it on the sale page.
  if (settled) return { completed: { ...r.data, tender: args.tender.kind } }
  return { redirectTo: `/pos/sales/${r.data.saleId}` }
}

type CounterTender = { kind: 'cash' } | { kind: 'card'; card: ExternalCard }

/**
 * Charge: record the tender for the full total and complete the sale,
 * through the same database functions the sale page uses (row locks, cents,
 * idempotent complete).
 *   cash  sale_add_payment
 *   card  sale_add_external_card_payment (0085) — the shop's card machine
 *         already approved it, so it counts at once.
 * If a step refuses, the sale stays OPEN and the clerk lands on its page,
 * where payment can be taken by hand — the sale itself is already saved, so
 * nothing is lost.
 */
async function settleAtCounter(
  args: { userId: string; tenantId: string },
  saleId: string,
  total: number,
  tender: CounterTender,
): Promise<boolean> {
  const { userId, tenantId } = args
  if (total > 0) {
    const paid =
      tender.kind === 'cash'
        ? await saleAddPayment({
            tenantId,
            userId,
            saleId,
            amount: total,
            method: 'cash',
            paymentIntentId: null,
            readerId: null,
            notes: null,
          })
        : await saleAddExternalCard({
            tenantId,
            userId,
            saleId,
            amount: total,
            last4: tender.card.last4,
            brand: tender.card.brand,
            authCode: tender.card.auth_code,
            notes: null,
          })
    if (!paid.ok) return false
    await logAudit({
      tenantId,
      userId,
      action: 'sale_payment_add',
      tableName: 'sale_payments',
      recordId: saleId,
      changes:
        tender.kind === 'cash'
          ? { amount: total, payment_method: 'cash', paid_total: paid.data.paidTotal, at: 'charge' }
          : {
              amount: total,
              payment_method: 'card',
              card_entry: 'external',
              card_brand: tender.card.brand,
              card_last4: tender.card.last4,
              paid_total: paid.data.paidTotal,
              at: 'charge',
            },
    })
  }
  const done = await saleComplete({ tenantId, userId, saleId })
  if (!done.ok || !done.data.completed) return false
  await logAudit({
    tenantId,
    userId,
    action: 'sale_complete',
    tableName: 'sales',
    recordId: saleId,
    changes: { total, at: 'charge' },
  })
  // Loyalty earn, referral, eBay end — same as completing on the sale page.
  await afterSaleCompleted({ tenantId, saleId })
  return true
}
