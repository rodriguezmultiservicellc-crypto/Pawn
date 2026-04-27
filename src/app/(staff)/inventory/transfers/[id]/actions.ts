'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/supabase/ctx'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { rejectTransferSchema } from '@/lib/validations/transfer'
import { logAudit } from '@/lib/audit'
import type { TransferStatus } from '@/types/database-aliases'

const STAFF_ROLES = [
  'owner',
  'chain_admin',
  'manager',
  'pawn_clerk',
] as const

type LoadedTransfer = {
  id: string
  from_tenant_id: string
  to_tenant_id: string
  status: TransferStatus
}

type LoadedItem = { inventory_item_id: string }

/**
 * Load the transfer + its child item ids using the admin client.
 * Returns null if not found or soft-deleted. We do NOT enforce access
 * control here — callers must verify the active tenant is on the right
 * side before mutating.
 */
async function loadTransfer(transferId: string): Promise<{
  transfer: LoadedTransfer
  itemIds: string[]
} | null> {
  const admin = createAdminClient()
  const { data: rawTransfer } = await admin
    .from('inventory_transfers')
    .select('id, from_tenant_id, to_tenant_id, status')
    .eq('id', transferId)
    .is('deleted_at', null)
    .maybeSingle()

  const transfer = rawTransfer as unknown as LoadedTransfer | null
  if (!transfer) return null

  const { data: rawItems } = await admin
    .from('inventory_transfer_items' as never)
    .select('inventory_item_id')
    .eq('transfer_id', transferId)

  const itemIds = ((rawItems as unknown as LoadedItem[] | null) ?? []).map(
    (r) => r.inventory_item_id,
  )

  return { transfer, itemIds }
}

/**
 * Accept a pending transfer. Viewer must be staff at to_tenant_id.
 *
 * On accept:
 *   1. inventory_transfers row → status='accepted', accepted_by/at set.
 *   2. Each inventory_item moves to to_tenant_id, status='available'.
 *      The cross-tenant tenant_id rewrite is performed via the admin
 *      client because the user-scoped client's RLS would block the
 *      transition (the WITH CHECK clause requires the new tenant_id be
 *      in my_accessible_tenant_ids() — which it IS for the receiver,
 *      but the row's existing tenant_id at evaluation time isn't, so
 *      the UPDATE would be blocked under "USING" before it can be
 *      checked under "WITH CHECK"). Documented here for posterity.
 */
export async function acceptTransferAction(
  formData: FormData,
): Promise<{ ok?: boolean; error?: string }> {
  const transferId = (formData.get('transfer_id') as string | null)?.trim()
  if (!transferId) return { error: 'missing_transfer_id' }

  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const loaded = await loadTransfer(transferId)
  if (!loaded) return { error: 'not_found' }
  const { transfer, itemIds } = loaded

  if (transfer.to_tenant_id !== ctx.tenantId) {
    return { error: 'not_authorized' }
  }
  if (transfer.status !== 'pending') {
    return { error: 'wrong_status' }
  }

  // The acting staff must be at to_tenant_id (or chain_admin parent).
  const { userId } = await requireRoleInTenant(transfer.to_tenant_id, STAFF_ROLES)

  const admin = createAdminClient()
  const nowIso = new Date().toISOString()

  // 1. Mark the transfer accepted.
  const { error: updErr } = await admin
    .from('inventory_transfers')
    .update({
      status: 'accepted',
      accepted_by: userId,
      accepted_at: nowIso,
      updated_by: userId,
    } as unknown as never)
    .eq('id', transferId)

  if (updErr) return { error: updErr.message }

  // 2. Move the items to the destination tenant + flip status to
  //    available. Admin client because the cross-tenant rewrite would
  //    fail under user-scoped RLS for the FROM-side staff.
  if (itemIds.length > 0) {
    const { error: itemsErr } = await admin
      .from('inventory_items')
      .update({
        tenant_id: transfer.to_tenant_id,
        status: 'available',
      })
      .in('id', itemIds)
    if (itemsErr) {
      // Best-effort revert of the transfer status flip.
      await admin
        .from('inventory_transfers')
        .update({
          status: 'pending',
          accepted_by: null,
          accepted_at: null,
        } as unknown as never)
        .eq('id', transferId)
      return { error: itemsErr.message }
    }
  }

  // Audit on BOTH sides — one row per tenant.
  await logAudit({
    tenantId: transfer.from_tenant_id,
    userId,
    action: 'transfer_accept',
    tableName: 'inventory_transfers',
    recordId: transferId,
    changes: { item_count: itemIds.length, side: 'from' },
  })
  await logAudit({
    tenantId: transfer.to_tenant_id,
    userId,
    action: 'transfer_accept',
    tableName: 'inventory_transfers',
    recordId: transferId,
    changes: { item_count: itemIds.length, side: 'to' },
  })

  revalidatePath(`/inventory/transfers/${transferId}`)
  revalidatePath('/inventory/transfers')
  revalidatePath('/inventory')
  return { ok: true }
}

/**
 * Reject a pending transfer. Viewer must be staff at to_tenant_id.
 * Items return to status='available' on the FROM side (their tenant_id
 * is unchanged — they were always at the from-tenant during the pending
 * window).
 */
export async function rejectTransferAction(
  formData: FormData,
): Promise<{ ok?: boolean; error?: string }> {
  const transferId = (formData.get('transfer_id') as string | null)?.trim()
  if (!transferId) return { error: 'missing_transfer_id' }

  const reasonRaw = formData.get('reason')
  const parsed = rejectTransferSchema.safeParse({ reason: reasonRaw })
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { error: issue?.message ?? 'validation_failed' }
  }
  const reason = parsed.data.reason

  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const loaded = await loadTransfer(transferId)
  if (!loaded) return { error: 'not_found' }
  const { transfer, itemIds } = loaded

  if (transfer.to_tenant_id !== ctx.tenantId) {
    return { error: 'not_authorized' }
  }
  if (transfer.status !== 'pending') {
    return { error: 'wrong_status' }
  }

  const { userId } = await requireRoleInTenant(transfer.to_tenant_id, STAFF_ROLES)

  const admin = createAdminClient()
  const nowIso = new Date().toISOString()

  const { error: updErr } = await admin
    .from('inventory_transfers')
    .update({
      status: 'rejected',
      rejected_by: userId,
      rejected_at: nowIso,
      rejection_reason: reason,
      updated_by: userId,
    } as unknown as never)
    .eq('id', transferId)
  if (updErr) return { error: updErr.message }

  // Release the hold on sender's items.
  if (itemIds.length > 0) {
    await admin
      .from('inventory_items')
      .update({ status: 'available' })
      .in('id', itemIds)
      .eq('tenant_id', transfer.from_tenant_id)
  }

  await logAudit({
    tenantId: transfer.from_tenant_id,
    userId,
    action: 'transfer_reject',
    tableName: 'inventory_transfers',
    recordId: transferId,
    changes: { reason, side: 'from' },
  })
  await logAudit({
    tenantId: transfer.to_tenant_id,
    userId,
    action: 'transfer_reject',
    tableName: 'inventory_transfers',
    recordId: transferId,
    changes: { reason, side: 'to' },
  })

  revalidatePath(`/inventory/transfers/${transferId}`)
  revalidatePath('/inventory/transfers')
  revalidatePath('/inventory')
  return { ok: true }
}

/**
 * Cancel a pending transfer. Viewer must be staff at from_tenant_id.
 * Items return to status='available' on the FROM side.
 */
export async function cancelTransferAction(
  formData: FormData,
): Promise<{ ok?: boolean; error?: string }> {
  const transferId = (formData.get('transfer_id') as string | null)?.trim()
  if (!transferId) return { error: 'missing_transfer_id' }

  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const loaded = await loadTransfer(transferId)
  if (!loaded) return { error: 'not_found' }
  const { transfer, itemIds } = loaded

  if (transfer.from_tenant_id !== ctx.tenantId) {
    return { error: 'not_authorized' }
  }
  if (transfer.status !== 'pending') {
    return { error: 'wrong_status' }
  }

  const { userId } = await requireRoleInTenant(
    transfer.from_tenant_id,
    STAFF_ROLES,
  )

  const admin = createAdminClient()
  const nowIso = new Date().toISOString()

  const { error: updErr } = await admin
    .from('inventory_transfers')
    .update({
      status: 'cancelled',
      cancelled_by: userId,
      cancelled_at: nowIso,
      updated_by: userId,
    } as unknown as never)
    .eq('id', transferId)
  if (updErr) return { error: updErr.message }

  if (itemIds.length > 0) {
    await admin
      .from('inventory_items')
      .update({ status: 'available' })
      .in('id', itemIds)
      .eq('tenant_id', transfer.from_tenant_id)
  }

  await logAudit({
    tenantId: transfer.from_tenant_id,
    userId,
    action: 'transfer_cancel',
    tableName: 'inventory_transfers',
    recordId: transferId,
    changes: { side: 'from' },
  })
  // Notify the destination side too, so HQ rollups see the event.
  await logAudit({
    tenantId: transfer.to_tenant_id,
    userId,
    action: 'transfer_cancel',
    tableName: 'inventory_transfers',
    recordId: transferId,
    changes: { side: 'to' },
  })

  revalidatePath(`/inventory/transfers/${transferId}`)
  revalidatePath('/inventory/transfers')
  revalidatePath('/inventory')
  return { ok: true }
}
