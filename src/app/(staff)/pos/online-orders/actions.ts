'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit'
import { CUSTOMER_DOCUMENTS_BUCKET, uploadToBucket } from '@/lib/supabase/storage'
import { extensionForUpload, resolveUploadMime } from '@/lib/uploads/mime'
import { prepareUpload } from '@/lib/uploads/convert'
import { ALLOWED_REPAIR_SIGNATURE_MIME_TYPES, MAX_REPAIR_SIGNATURE_BYTES } from '@/lib/validations/repair'
import { sendOrderMessage } from '@/lib/store/orders'
import type { Database } from '@/types/database'

type Result = { ok: true } | { ok: false; error: string }

const ROLES = ['owner', 'chain_admin', 'manager', 'pawn_clerk'] as const
const ERRORS = ['bad_transition', 'tracking_required', 'pickup_check_required', 'order_not_found'] as const

async function guard() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  const { userId } = await requireRoleInTenant(ctx.tenantId, ROLES)
  return { tenantId: ctx.tenantId, userId }
}

async function advance(args: {
  tenantId: string
  userId: string
  orderId: string
  to: 'picking' | 'ready' | 'shipped' | 'completed'
  carrier?: string | null
  tracking?: string | null
  pickupName?: string | null
  pickupId?: string | null
  signaturePath?: string | null
}): Promise<Result> {
  const params = {
    p_tenant_id: args.tenantId,
    p_order_id: args.orderId,
    p_user_id: args.userId,
    p_to: args.to,
    p_carrier: args.carrier ?? null,
    p_tracking: args.tracking ?? null,
    p_pickup_name: args.pickupName ?? null,
    p_pickup_id: args.pickupId ?? null,
    p_signature_path: args.signaturePath ?? null,
  } as unknown as Database['public']['Functions']['online_order_advance']['Args']
  const { error } = await createAdminClient().rpc('online_order_advance', params)
  if (error) {
    const token = ERRORS.find((e) => error.message.includes(e)) ?? 'generic'
    return { ok: false, error: token }
  }

  await logAudit({
    tenantId: args.tenantId,
    userId: args.userId,
    action: 'online_order_advance',
    tableName: 'online_orders',
    recordId: args.orderId,
    changes: {
      to: args.to,
      carrier: args.carrier ?? undefined,
      tracking: args.tracking ?? undefined,
      picked_up_by: args.pickupName ?? undefined,
      signature: args.signaturePath ? true : undefined,
    },
  })

  if (args.to === 'ready') await sendOrderMessage({ tenantId: args.tenantId, orderId: args.orderId, kind: 'online_order_ready' })
  if (args.to === 'shipped') await sendOrderMessage({ tenantId: args.tenantId, orderId: args.orderId, kind: 'online_order_shipped' })

  revalidatePath('/pos/online-orders')
  revalidatePath(`/pos/online-orders/${args.orderId}`)
  revalidatePath('/dashboard')
  return { ok: true }
}

/** Picking, ready for pickup, or delivered (a shipped order). */
export async function advanceOrderAction(orderId: string, to: 'picking' | 'ready' | 'completed'): Promise<Result> {
  const { tenantId, userId } = await guard()
  return advance({ tenantId, userId, orderId, to })
}

export async function shipOrderAction(orderId: string, carrier: string, tracking: string): Promise<Result> {
  const { tenantId, userId } = await guard()
  return advance({
    tenantId,
    userId,
    orderId,
    to: 'shipped',
    carrier: carrier.trim().slice(0, 60),
    tracking: tracking.trim().slice(0, 80),
  })
}

/**
 * Pickup handover: who collected it, the ID checked, and their signature
 * (a photo or scan, like the repair pickup). All three are required.
 */
export async function handOverOrderAction(formData: FormData): Promise<Result> {
  const { tenantId, userId } = await guard()
  const orderId = String(formData.get('order_id') ?? '')
  const pickupName = String(formData.get('pickup_name') ?? '').trim().slice(0, 120)
  const pickupId = String(formData.get('pickup_id') ?? '').trim().slice(0, 120)
  const sig = formData.get('signature_file')
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return { ok: false, error: 'order_not_found' }
  if (pickupName.length < 2 || pickupId.length < 2 || !(sig instanceof File) || sig.size === 0) {
    return { ok: false, error: 'pickup_check_required' }
  }
  if (sig.size > MAX_REPAIR_SIGNATURE_BYTES) return { ok: false, error: 'too_large' }
  const mime = resolveUploadMime(sig)
  if (!ALLOWED_REPAIR_SIGNATURE_MIME_TYPES.includes(mime as never)) return { ok: false, error: 'mime_not_allowed' }

  // The order must belong to this shop before anything is written for it.
  const { data: order } = await createAdminClient()
    .from('online_orders')
    .select('id, status')
    .eq('id', orderId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!order) return { ok: false, error: 'order_not_found' }
  if (order.status !== 'ready') return { ok: false, error: 'bad_transition' }

  const up = await prepareUpload(sig, mime)
  const path = `${tenantId}/online-orders/${orderId}/signature_${crypto.randomUUID()}.${extensionForUpload(up.mime, up.filename)}`
  try {
    await uploadToBucket({ bucket: CUSTOMER_DOCUMENTS_BUCKET, path, body: up.body, contentType: up.mime })
  } catch (err) {
    console.error('[online-orders.handover] signature upload failed', err)
    return { ok: false, error: 'generic' }
  }

  return advance({ tenantId, userId, orderId, to: 'completed', pickupName, pickupId, signaturePath: path })
}
