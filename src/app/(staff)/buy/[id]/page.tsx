import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { INVENTORY_PHOTOS_BUCKET, getSignedUrl } from '@/lib/supabase/storage'
import BuyReceiptContent, { type BuyReceiptView } from './content'

/**
 * Buy-outright receipt / confirmation page. After a successful buy
 * intake the action redirects here using the FIRST inventory item's id
 * as the path param. We use that to look up the compliance_log row
 * (source_table='inventory_items', source_id=id, event_type=
 * 'buy_outright') and render the customer + items + payout.
 *
 * Browser-printable (Cmd+P). A proper bilingual PDF receipt is on the
 * backlog — same shape as the pawn ticket PDF.
 */
export default async function BuyReceiptPage(props: {
  params: Promise<{ id: string }>
}) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  await requireRoleInTenant(ctx.tenantId, [
    'owner',
    'manager',
    'pawn_clerk',
    'chain_admin',
  ])

  const { id } = await props.params

  const admin = createAdminClient()

  // Look up the compliance_log row for this buy. We anchor on source_id
  // = first item's id; if the operator opens a non-anchor item's URL we
  // still find the transaction via items_snapshot below.
  const { data: complianceRow } = await admin
    .from('compliance_log')
    .select('*')
    .eq('tenant_id', ctx.tenantId)
    .eq('source_table', 'inventory_items')
    .eq('source_id', id)
    .eq('event_type', 'buy_outright')
    .maybeSingle()

  if (!complianceRow) {
    redirect('/inventory')
  }

  // Customer info from snapshot.
  const cs = (complianceRow.customer_snapshot ?? {}) as Record<string, unknown>
  const customerName = [cs.first_name, cs.middle_name, cs.last_name]
    .filter(Boolean)
    .join(' ')

  // Item snapshots — pull the live inventory rows for the SKUs (so the
  // operator gets clickable links + sees the live status).
  const itemsSnap = (
    Array.isArray(complianceRow.items_snapshot)
      ? complianceRow.items_snapshot
      : []
  ) as Array<Record<string, unknown>>

  const itemIds = itemsSnap
    .map((it) => (typeof it.inventory_item_id === 'string' ? it.inventory_item_id : null))
    .filter((x): x is string => !!x)

  const { data: liveItems } = itemIds.length
    ? await admin
        .from('inventory_items')
        .select('id, sku, status, hold_until')
        .eq('tenant_id', ctx.tenantId)
        .in('id', itemIds)
    : { data: [] }

  const liveById = new Map<string, { sku: string; status: string; hold_until: string | null }>()
  for (const it of liveItems ?? []) {
    liveById.set(it.id, {
      sku: it.sku,
      status: it.status,
      hold_until: it.hold_until,
    })
  }

  // Each item's photos as they are now on its inventory record (where they
  // are changed), main first — the inventory page's order. 1h signed URLs.
  const { data: photoRows } = itemIds.length
    ? await admin
        .from('inventory_item_photos')
        .select('item_id, storage_path')
        .eq('tenant_id', ctx.tenantId)
        .in('item_id', itemIds)
        .is('deleted_at', null)
        .order('is_primary', { ascending: false })
        .order('position', { ascending: true })
    : { data: [] }
  const signed = await Promise.all(
    (photoRows ?? []).map(async (p) => ({
      itemId: p.item_id,
      url: await getSignedUrl({
        bucket: INVENTORY_PHOTOS_BUCKET,
        path: p.storage_path,
        ttlSeconds: 3600,
      }),
    })),
  )
  const photosById = new Map<string, string[]>()
  for (const p of signed) {
    if (!p.url) continue
    photosById.set(p.itemId, [...(photosById.get(p.itemId) ?? []), p.url])
  }

  const view: BuyReceiptView = {
    transactionId: complianceRow.id,
    occurredAt: complianceRow.occurred_at ?? complianceRow.created_at ?? null,
    totalPayout: complianceRow.amount != null ? Number(complianceRow.amount) : 0,
    customer: {
      name: customerName || '—',
      idNumber: typeof cs.id_number === 'string' ? cs.id_number : null,
      idType: typeof cs.id_type === 'string' ? cs.id_type : null,
      phone: typeof cs.phone === 'string' ? cs.phone : null,
      email: typeof cs.email === 'string' ? cs.email : null,
      address: [cs.address1, cs.city, cs.state, cs.zip]
        .filter(Boolean)
        .join(', '),
    },
    items: itemsSnap.map((it) => {
      const inventoryId =
        typeof it.inventory_item_id === 'string' ? it.inventory_item_id : null
      const live = inventoryId ? liveById.get(inventoryId) ?? null : null
      return {
        inventoryId,
        sku: live?.sku ?? (typeof it.sku === 'string' ? it.sku : '—'),
        description:
          typeof it.description === 'string' ? it.description : '—',
        category: typeof it.category === 'string' ? it.category : null,
        metal: typeof it.metal_type === 'string' ? it.metal_type : null,
        karat: typeof it.karat === 'string' ? it.karat : null,
        weightGrams:
          typeof it.weight_grams === 'number'
            ? it.weight_grams
            : typeof it.weight_grams === 'string'
              ? Number(it.weight_grams)
              : null,
        payout:
          typeof it.payout === 'number'
            ? it.payout
            : typeof it.payout === 'string'
              ? Number(it.payout)
              : 0,
        meltAtBuy:
          typeof it.melt_value_at_buy === 'number'
            ? it.melt_value_at_buy
            : null,
        serialNumber:
          typeof it.serial_number === 'string' ? it.serial_number : null,
        liveStatus: live?.status ?? null,
        holdUntil: live?.hold_until ?? null,
        photoUrls: inventoryId ? photosById.get(inventoryId) ?? [] : [],
      }
    }),
  }

  return <BuyReceiptContent view={view} />
}
