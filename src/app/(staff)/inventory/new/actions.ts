'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/supabase/ctx'
import { requireStaff } from '@/lib/supabase/guards'
import { inventoryItemCreateSchema } from '@/lib/validations/inventory'
import { logAudit } from '@/lib/audit'

export type CreateInventoryItemState = {
  error?: string
  fieldErrors?: Record<string, string>
}

export async function createInventoryItemAction(
  _prev: CreateInventoryItemState,
  formData: FormData,
): Promise<CreateInventoryItemState> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const { supabase, userId } = await requireStaff(ctx.tenantId)

  const raw: Record<string, FormDataEntryValue | null> = {}
  for (const key of [
    'sku',
    'description',
    'category',
    'brand',
    'model',
    'serial_number',
    'metal',
    'karat',
    'weight_grams',
    'weight_dwt',
    'cost_basis',
    'list_price',
    'source',
    'source_vendor',
    'acquired_at',
    'acquired_cost',
    'hold_until',
    'location',
    'status',
    'notes',
    'staff_memo',
    'tags',
  ]) {
    raw[key] = formData.get(key)
  }

  const parsed = inventoryItemCreateSchema.safeParse(raw)
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.')
      if (path) fieldErrors[path] = issue.message
    }
    return { fieldErrors }
  }

  const v = parsed.data

  // The BEFORE INSERT trigger assigns sku + sku_number when sku is null.
  // When sku is provided, we set sku_number to 0 (the trigger does this
  // too, but explicit beats implicit on the TS side since sku_number is
  // NOT NULL).
  const { data, error } = await supabase
    .from('inventory_items')
    .insert({
      tenant_id: ctx.tenantId,
      sku: v.sku ?? '',
      sku_number: 0,
      description: v.description,
      category: v.category,
      brand: v.brand,
      model: v.model,
      serial_number: v.serial_number,
      metal: v.metal ?? null,
      karat: v.karat,
      weight_grams: v.weight_grams,
      weight_dwt: v.weight_dwt,
      cost_basis: v.cost_basis,
      list_price: v.list_price,
      source: v.source,
      source_vendor: v.source_vendor,
      acquired_at: v.acquired_at,
      acquired_cost: v.acquired_cost,
      hold_until: v.hold_until,
      location: v.location,
      status: v.status,
      notes: v.notes,
      staff_memo: v.staff_memo,
      tags: v.tags,
      created_by: userId,
      updated_by: userId,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }
  if (!data?.id) return { error: 'insert returned no id' }

  await logAudit({
    tenantId: ctx.tenantId,
    userId,
    action: 'create',
    tableName: 'inventory_items',
    recordId: data.id,
    changes: {
      sku: v.sku,
      description: v.description,
      category: v.category,
      source: v.source,
      cost_basis: v.cost_basis,
    },
  })

  revalidatePath('/inventory')
  redirect(`/inventory/${data.id}`)
}
