import 'server-only'

import { redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { saleCreateSchema, taxExemptionOf, type SaleCreateInput, type SaleItemInput } from '@/lib/validations/pos'
import { logAudit } from '@/lib/audit'
import { posErrorKey, saleCreate, type SaleLineInput } from '@/lib/pos/money'

/**
 * The New sale counter's shared steps, used by Charge (actions.ts — cash and
 * card machine) and Charge on the card reader (reader-actions.ts). NOT a
 * 'use server' module: these are helpers, not callable actions.
 */

export const SALE_STAFF_ROLES = ['owner', 'manager', 'pawn_clerk', 'chain_admin'] as const

export type IncomingItem = {
  inventory_item_id: string | null
  description: string
  quantity: string
  unit_price: string
  line_discount: string
  position: string
}

export function readItems(fd: FormData): IncomingItem[] {
  const countRaw = fd.get('items_count')
  const count = Math.max(0, Math.min(200, parseInt(String(countRaw ?? '0'), 10) || 0))
  const out: IncomingItem[] = []
  for (let i = 0; i < count; i++) {
    out.push({
      inventory_item_id: (fd.get(`item_${i}_inventory_item_id`) as string | null) || null,
      description: String(fd.get(`item_${i}_description`) ?? ''),
      quantity: String(fd.get(`item_${i}_quantity`) ?? '1'),
      unit_price: String(fd.get(`item_${i}_unit_price`) ?? '0'),
      line_discount: String(fd.get(`item_${i}_line_discount`) ?? '0'),
      position: String(i),
    })
  }
  return out
}

export type CounterContext = {
  supabase: SupabaseClient<Database>
  userId: string
  tenantId: string
  registerSessionId: string
}

/** Signed in, retail on, a counter role, and an open register — or the reason not. */
export async function counterContext(): Promise<{ ok: true; c: CounterContext } | { ok: false; error: string }> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  const tenantId = ctx.tenantId

  const { data: tenant } = await ctx.supabase.from('tenants').select('has_retail').eq('id', tenantId).maybeSingle()
  if (!tenant?.has_retail) return { ok: false, error: 'notAuthorized' }

  const { supabase, userId } = await requireRoleInTenant(tenantId, SALE_STAFF_ROLES)

  // Sales must be tied to an open register session.
  const { data: openSession } = await supabase
    .from('register_sessions')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('status', 'open')
    .is('deleted_at', null)
    .maybeSingle()
  if (!openSession) return { ok: false, error: 'noOpenSession' }

  return { ok: true, c: { supabase, userId, tenantId, registerSessionId: openSession.id } }
}

/** The retail cart from the form, validated. */
export function parseRetail(formData: FormData): { ok: true; v: SaleCreateInput } | { ok: false; error: string } {
  const parsed = saleCreateSchema.safeParse({
    customer_id: formData.get('customer_id'),
    tax_rate: formData.get('tax_rate'),
    tax_mode: formData.get('tax_mode'),
    tax_exempt_reason: formData.get('tax_exempt_reason'),
    tax_exempt_certificate: formData.get('tax_exempt_certificate'),
    discount_amount: formData.get('discount_amount'),
    notes: formData.get('notes'),
    items: readItems(formData),
  })
  if (!parsed.success) return { ok: false, error: 'validationFailed' }
  if (parsed.data.items.length === 0) return { ok: false, error: 'cartEmpty' }
  return { ok: true, v: parsed.data }
}

export function toLines(items: SaleItemInput[]): SaleLineInput[] {
  return items.map((it) => ({
    inventory_item_id: it.inventory_item_id ?? null,
    description: it.description,
    quantity: Number(it.quantity),
    unit_price: Number(it.unit_price),
    line_discount: Number(it.line_discount ?? 0),
  }))
}

export type CreatedSale = { saleId: string; saleNumber: string | null; total: number }

/** sale_create (0076: row locks, cents, pieces marked sold) + the audit row. */
export async function createRetailSale(
  c: CounterContext,
  v: SaleCreateInput,
): Promise<{ ok: true; sale: CreatedSale } | { ok: false; error: string }> {
  const r = await saleCreate({
    tenantId: c.tenantId,
    userId: c.userId,
    registerSessionId: c.registerSessionId,
    customerId: v.customer_id ?? null,
    taxRate: v.tax_rate,
    taxMode: v.tax_mode,
    taxExempt: taxExemptionOf(v),
    discount: v.discount_amount,
    notes: v.notes ?? null,
    items: toLines(v.items),
  })
  if (!r.ok) return { ok: false, error: posErrorKey(r.error) }

  await logAudit({
    tenantId: c.tenantId,
    userId: c.userId,
    action: 'sale_create',
    tableName: 'sales',
    recordId: r.data.saleId,
    changes: {
      sale_number: r.data.saleNumber,
      sale_kind: 'retail',
      customer_id: v.customer_id ?? null,
      total: r.data.total,
      item_count: v.items.length,
      ...(v.tax_mode === 'exempt'
        ? { tax_exempt_reason: v.tax_exempt_reason, tax_exempt_certificate: v.tax_exempt_certificate }
        : {}),
    },
  })
  return { ok: true, sale: r.data }
}
