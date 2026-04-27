'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/supabase/ctx'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { createTransferSchema } from '@/lib/validations/transfer'
import { logAudit } from '@/lib/audit'

export type CreateTransferState = {
  error?: string
  fieldErrors?: Record<string, string>
}

const TRANSFER_ROLES = ['owner', 'chain_admin', 'manager', 'pawn_clerk'] as const

/**
 * Create an inventory transfer request from the active tenant (origin) to
 * a destination sibling shop. Items are held during the transfer
 * (status='transferred') until the destination accepts (and the items
 * change tenant_id) or rejects/cancels (and the items go back to
 * 'available').
 *
 * Cross-chain transfers are blocked at the DB trigger level (0003). We
 * also do an explicit sibling check here for a friendlier error.
 */
export async function createTransferAction(
  _prev: CreateTransferState,
  formData: FormData,
): Promise<CreateTransferState> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const { userId } = await requireRoleInTenant(ctx.tenantId, TRANSFER_ROLES)

  const itemIds = formData.getAll('item_ids').filter((v): v is string =>
    typeof v === 'string',
  )

  const raw = {
    destination_tenant_id: formData.get('destination_tenant_id'),
    item_ids: itemIds,
    notes: formData.get('notes'),
  }

  const parsed = createTransferSchema.safeParse(raw)
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.')
      if (path) fieldErrors[path] = issue.message
    }
    return { fieldErrors }
  }

  const v = parsed.data
  if (v.destination_tenant_id === ctx.tenantId) {
    return {
      fieldErrors: {
        destination_tenant_id: 'cannot_transfer_to_self',
      },
    }
  }

  const admin = createAdminClient()

  // Sibling check (defense-in-depth — the cross-chain trigger handles
  // the DB-level enforcement). Also validates that both shops are 'shop'
  // type, not chain_hq / standalone.
  const { data: tenants, error: tenantsErr } = await admin
    .from('tenants')
    .select('id, parent_tenant_id, tenant_type')
    .in('id', [ctx.tenantId, v.destination_tenant_id])

  if (tenantsErr) return { error: tenantsErr.message }

  const fromTenant = tenants?.find((t) => t.id === ctx.tenantId)
  const toTenant = tenants?.find((t) => t.id === v.destination_tenant_id)
  if (!fromTenant || !toTenant) {
    return { error: 'invalid_tenants' }
  }
  if (
    fromTenant.tenant_type !== 'shop' ||
    toTenant.tenant_type !== 'shop' ||
    !fromTenant.parent_tenant_id ||
    fromTenant.parent_tenant_id !== toTenant.parent_tenant_id
  ) {
    return {
      fieldErrors: { destination_tenant_id: 'not_sibling' },
    }
  }

  // Verify all items belong to the active tenant AND are currently
  // available. We use the user-scoped client for the read (RLS gates),
  // and we'll switch to admin only for the cross-tenant writes later.
  const { data: itemsCheck, error: itemsErr } = await ctx.supabase
    .from('inventory_items')
    .select('id, sku, description, status, list_price, cost_basis')
    .in('id', v.item_ids)
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)

  if (itemsErr) return { error: itemsErr.message }
  const items = itemsCheck ?? []
  if (items.length !== v.item_ids.length) {
    return { error: 'items_not_found' }
  }
  const notAvailable = items.find((it) => it.status !== 'available')
  if (notAvailable) {
    return { error: 'items_not_available' }
  }

  // Insert the parent transfer row. The legacy `item_id` column is now
  // nullable (post-0006); we leave it null for multi-item transfers and
  // store the item set in inventory_transfer_items below.
  type InsertedTransfer = { id: string }
  const insertPayload = {
    tenant_id: ctx.tenantId,
    from_tenant_id: ctx.tenantId,
    to_tenant_id: v.destination_tenant_id,
    item_id: null,
    status: 'pending' as const,
    notes: v.notes,
    requested_by: userId,
    requested_at: new Date().toISOString(),
  }

  const { data: createdData, error: insertErr } = await admin
    .from('inventory_transfers')
    .insert(
      // The current generated types lag the 0006 schema (which makes
      // item_id nullable + adds requested_by/at). Cast at the boundary.
      insertPayload as unknown as never,
    )
    .select('id')
    .single()

  if (insertErr) {
    // Surface the cross-chain trigger error in a recognizable way.
    if (
      insertErr.message?.includes('inventory_transfers blocked') ||
      insertErr.message?.includes('inventory_transfers requires')
    ) {
      return {
        fieldErrors: {
          destination_tenant_id: 'cross_chain_blocked',
        },
      }
    }
    return { error: insertErr.message }
  }
  const transferId = (createdData as InsertedTransfer | null)?.id
  if (!transferId) return { error: 'insert_returned_no_id' }

  // Insert child rows. tenant_id is the OWNER side at request time
  // (== from_tenant_id).
  const childRows = items.map((it) => ({
    tenant_id: ctx.tenantId!,
    transfer_id: transferId,
    inventory_item_id: it.id,
    sku_snapshot: it.sku,
    description_snapshot: it.description,
    est_value:
      it.list_price != null
        ? typeof it.list_price === 'number'
          ? it.list_price
          : parseFloat(String(it.list_price))
        : it.cost_basis != null
        ? typeof it.cost_basis === 'number'
          ? it.cost_basis
          : parseFloat(String(it.cost_basis))
        : null,
  }))

  const { error: childErr } = await admin
    .from('inventory_transfer_items' as never)
    .insert(childRows as unknown as never)
  if (childErr) {
    // Best-effort rollback of the parent.
    await admin
      .from('inventory_transfers')
      .delete()
      .eq('id', transferId)
    return { error: childErr.message }
  }

  // Hold the items so they can't be sold or re-transferred while pending.
  const { error: holdErr } = await admin
    .from('inventory_items')
    .update({ status: 'transferred' })
    .in('id', v.item_ids)
    .eq('tenant_id', ctx.tenantId)
  if (holdErr) {
    return { error: holdErr.message }
  }

  await logAudit({
    tenantId: ctx.tenantId,
    userId,
    action: 'transfer_request',
    tableName: 'inventory_transfers',
    recordId: transferId,
    changes: {
      to_tenant_id: v.destination_tenant_id,
      item_count: v.item_ids.length,
    },
  })

  revalidatePath('/inventory/transfers')
  revalidatePath('/inventory')
  redirect(`/inventory/transfers/${transferId}`)
}
