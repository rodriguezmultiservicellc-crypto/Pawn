import { notFound, redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { CUSTOMER_DOCUMENTS_BUCKET, getSignedUrl } from '@/lib/supabase/storage'
import OnlineOrderDetail, { type OrderDetail } from './content'

export const dynamic = 'force-dynamic'

const STAFF = new Set(['owner', 'chain_admin', 'manager', 'pawn_clerk'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function OnlineOrderPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  if (!ctx.tenantRole || !STAFF.has(ctx.tenantRole)) redirect('/dashboard')
  if (!UUID.test(id)) notFound()

  const [{ data: o }, { data: items }] = await Promise.all([
    ctx.supabase.from('online_orders').select('*').eq('tenant_id', ctx.tenantId).eq('id', id).maybeSingle(),
    ctx.supabase
      .from('online_order_items')
      .select('inventory_item_id, sku, description, unit_price')
      .eq('tenant_id', ctx.tenantId)
      .eq('order_id', id)
      .order('position'),
  ])
  if (!o) notFound()

  // Signed URL only after the RLS read above proved the order is this shop's.
  const signatureUrl = o.pickup_signature_path
    ? await getSignedUrl({ bucket: CUSTOMER_DOCUMENTS_BUCKET, path: o.pickup_signature_path, ttlSeconds: 3600 })
    : null

  const order: OrderDetail = {
    id: o.id,
    orderNumber: o.order_number,
    status: o.status,
    fulfillment: o.fulfillment as 'pickup' | 'ship',
    contactName: o.contact_name,
    contactEmail: o.contact_email,
    contactPhone: o.contact_phone,
    address: o.fulfillment === 'ship'
      ? [o.ship_line1, o.ship_line2, `${o.ship_city ?? ''}, ${o.ship_state ?? ''} ${o.ship_postal ?? ''}`].filter(Boolean).join('\n')
      : null,
    signatureRequired: o.signature_required,
    subtotal: Number(o.subtotal),
    shipping: Number(o.shipping_amount),
    tax: Number(o.tax_amount),
    total: Number(o.total),
    saleId: o.sale_id,
    customerId: o.customer_id,
    createdAt: o.created_at,
    paidAt: o.paid_at,
    readyAt: o.ready_at,
    shippedAt: o.shipped_at,
    completedAt: o.completed_at,
    carrier: o.carrier,
    tracking: o.tracking_number,
    pickedUpBy: o.picked_up_by_name,
    pickupId: o.pickup_id_check,
    signatureUrl,
    refundReason: o.refund_reason,
    items: (items ?? []).map((i) => ({
      inventoryItemId: i.inventory_item_id,
      sku: i.sku,
      description: i.description,
      price: Number(i.unit_price),
    })),
  }
  return <OnlineOrderDetail order={order} />
}
