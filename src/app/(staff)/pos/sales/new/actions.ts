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
import { afterSaleCompleted, layawayCreate, posErrorKey, saleCreate, type SaleLineInput } from '@/lib/pos/money'
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
  if (!tenant?.has_retail) return { error: 'not_authorized' }

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
    return { error: 'validation_failed' }
  }
  const v = parsed.data

  return persistSale({
    userId,
    tenantId,
    registerSessionId: openSession.id,
    customerId: v.customer_id,
    items: v.items,
    taxRate: v.tax_rate,
    discountAmount: v.discount_amount,
    notes: v.notes,
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

  revalidatePath('/pos')
  revalidatePath('/pos/sales')
  return { redirectTo: `/pos/sales/${r.data.saleId}` }
}
