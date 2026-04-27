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
import { computeLineTotal, computeSubtotal, computeTotal, r4, toMoney } from '@/lib/pos/cart'
import type { LayawayScheduleKind, PaymentMethod } from '@/types/database-aliases'

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

// Type alias for the user-scoped Supabase client returned by getCtx().
type SupabaseClient = NonNullable<Awaited<ReturnType<typeof getCtx>>>['supabase']

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
      supabase,
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
    supabase,
    userId,
    tenantId,
    saleKind: 'retail',
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
  supabase: SupabaseClient
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

  const persisted = await persistSale({
    supabase: args.supabase,
    userId: args.userId,
    tenantId: args.tenantId,
    saleKind: 'layaway',
    registerSessionId: args.registerSessionId,
    customerId: v.customer_id,
    items: v.items,
    taxRate: v.tax_rate,
    discountAmount: v.discount_amount,
    notes: v.notes,
  })
  if (persisted.error || !persisted.saleId) return persisted

  // Insert layaway row.
  const { data: lay, error: layErr } = await args.supabase
    .from('layaways')
    .insert({
      tenant_id: args.tenantId,
      sale_id: persisted.saleId,
      customer_id: v.customer_id,
      status: 'active',
      total_due: persisted.total ?? 0,
      paid_total: 0,
      balance_remaining: persisted.total ?? 0,
      schedule_kind: v.schedule_kind as LayawayScheduleKind,
      down_payment: v.down_payment,
      first_payment_due: v.first_payment_due,
      final_due_date: v.final_due_date,
      cancellation_fee_pct: v.cancellation_fee_pct,
      notes: v.notes,
      created_by: args.userId,
      updated_by: args.userId,
    })
    .select('id, layaway_number')
    .single()
  if (layErr || !lay) return { error: layErr?.message ?? 'layaway_insert_failed' }

  // If a down payment was collected, write a sale_payment AND a layaway_payment.
  if (v.down_payment > 0) {
    await args.supabase.from('sale_payments').insert({
      sale_id: persisted.saleId,
      tenant_id: args.tenantId,
      amount: v.down_payment,
      payment_method: v.down_payment_method as PaymentMethod,
      card_present_status:
        v.down_payment_method === 'card' ? 'pending' : 'not_used',
      performed_by: args.userId,
    })
    await args.supabase.from('layaway_payments').insert({
      layaway_id: lay.id,
      tenant_id: args.tenantId,
      amount: v.down_payment,
      payment_method: v.down_payment_method as PaymentMethod,
      card_present_status:
        v.down_payment_method === 'card' ? 'pending' : 'not_used',
      performed_by: args.userId,
      notes: 'down_payment',
    })
    // Roll forward the parent sale + layaway totals.
    const newPaid = r4(toMoney(v.down_payment))
    await args.supabase
      .from('sales')
      .update({
        paid_total: newPaid,
        updated_by: args.userId,
      })
      .eq('id', persisted.saleId)
      .eq('tenant_id', args.tenantId)
    await args.supabase
      .from('layaways')
      .update({
        paid_total: newPaid,
        balance_remaining: r4(Math.max(0, (persisted.total ?? 0) - newPaid)),
        updated_by: args.userId,
      })
      .eq('id', lay.id)
      .eq('tenant_id', args.tenantId)
  }

  await logAudit({
    tenantId: args.tenantId,
    userId: args.userId,
    action: 'layaway_create',
    tableName: 'layaways',
    recordId: lay.id,
    changes: {
      layaway_number: lay.layaway_number,
      sale_id: persisted.saleId,
      total_due: persisted.total,
      down_payment: v.down_payment,
      schedule_kind: v.schedule_kind,
    },
  })

  revalidatePath('/pos')
  revalidatePath('/pos/layaways')
  return { redirectTo: `/pos/layaways/${lay.id}` }
}

// ── Shared persistence path for retail OR layaway sales. ───────────────────

async function persistSale(args: {
  supabase: SupabaseClient
  userId: string
  tenantId: string
  saleKind: 'retail' | 'layaway'
  registerSessionId: string
  customerId: string | null
  items: SaleItemInput[]
  taxRate: number
  discountAmount: number
  notes: string | null
}): Promise<CreateSaleResult & { saleId?: string; total?: number }> {
  if (args.items.length === 0) return { error: 'cartEmpty' }

  // Compute totals from validated items.
  const subtotal = computeSubtotal(
    args.items.map((it) => ({
      quantity: it.quantity,
      unit_price: it.unit_price,
      line_discount: it.line_discount,
    })),
  )
  const totals = computeTotal({
    subtotal,
    discount: args.discountAmount,
    tax_rate: args.taxRate,
  })

  // Pre-flight: every linked inventory item must currently be 'available'.
  const linkedIds = args.items
    .map((it) => it.inventory_item_id)
    .filter((x): x is string => !!x)
  if (linkedIds.length > 0) {
    const { data: invRows } = await args.supabase
      .from('inventory_items')
      .select('id, status')
      .eq('tenant_id', args.tenantId)
      .in('id', linkedIds)
    const lookup = new Map<string, string>()
    for (const r of invRows ?? []) lookup.set(r.id, r.status)
    for (const id of linkedIds) {
      const st = lookup.get(id)
      if (st !== 'available') return { error: 'inventoryOutOfStock' }
    }
  }

  // Insert sale.
  const { data: sale, error: saleErr } = await args.supabase
    .from('sales')
    .insert({
      tenant_id: args.tenantId,
      register_session_id: args.registerSessionId,
      sale_kind: args.saleKind,
      status: 'open',
      customer_id: args.customerId,
      subtotal: totals.subtotal,
      tax_amount: totals.tax,
      tax_rate: args.taxRate,
      discount_amount: totals.discount,
      total: totals.total,
      paid_total: 0,
      returned_total: 0,
      notes: args.notes,
      is_locked: false,
      created_by: args.userId,
      updated_by: args.userId,
    })
    .select('id, sale_number')
    .single()
  if (saleErr || !sale) return { error: saleErr?.message ?? 'sale_insert_failed' }

  // Insert sale_items.
  const itemsPayload = args.items.map((it, i) => ({
    sale_id: sale.id,
    tenant_id: args.tenantId,
    inventory_item_id: it.inventory_item_id,
    description: it.description,
    quantity: it.quantity,
    unit_price: it.unit_price,
    line_discount: it.line_discount,
    line_total: computeLineTotal({
      quantity: it.quantity,
      unit_price: it.unit_price,
      line_discount: it.line_discount,
    }),
    position: i,
    returned_qty: 0,
  }))
  const { error: itErr } = await args.supabase
    .from('sale_items')
    .insert(itemsPayload)
  if (itErr) return { error: itErr.message }

  // Flip inventory status: layaway -> 'held'; retail -> 'sold'.
  const newStatus = args.saleKind === 'layaway' ? 'held' : 'sold'
  for (const id of linkedIds) {
    await args.supabase
      .from('inventory_items')
      .update({ status: newStatus, updated_by: args.userId })
      .eq('id', id)
      .eq('tenant_id', args.tenantId)
      .eq('status', 'available')
  }

  await logAudit({
    tenantId: args.tenantId,
    userId: args.userId,
    action: 'sale_create',
    tableName: 'sales',
    recordId: sale.id,
    changes: {
      sale_number: sale.sale_number,
      sale_kind: args.saleKind,
      customer_id: args.customerId,
      total: totals.total,
      item_count: args.items.length,
    },
  })

  revalidatePath('/pos')
  revalidatePath('/pos/sales')

  return {
    saleId: sale.id,
    total: totals.total,
    redirectTo:
      args.saleKind === 'retail' ? `/pos/sales/${sale.id}` : undefined,
  }
}
