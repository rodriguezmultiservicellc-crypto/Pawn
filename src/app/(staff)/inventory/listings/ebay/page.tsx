import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { createAdminClient } from '@/lib/supabase/admin'
import EbayListingsListContent, { type EbayListingListRow } from './content'
import type {
  EbayListingRow,
  EbayListingStatus,
} from '@/types/database-aliases'

const STATUS_TABS: EbayListingStatus[] = [
  'draft',
  'active',
  'sold',
  'ended',
  'error',
]

type SearchParams = Promise<{ status?: string }>

export default async function EbayListingsPage(props: {
  searchParams: SearchParams
}) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const params = await props.searchParams
  const tab = (params.status ?? 'draft') as EbayListingStatus
  const status: EbayListingStatus = STATUS_TABS.includes(tab) ? tab : 'draft'

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supa = admin as any

  const { data: rows } = (await supa
    .from('ebay_listings')
    .select(
      'id, ebay_sku, ebay_listing_id, title, list_price, currency, format, status, view_count, watcher_count, last_synced_at, created_at, inventory_item_id',
    )
    .eq('tenant_id', ctx.tenantId)
    .eq('status', status)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(200)) as { data: EbayListingRow[] | null }

  const list: EbayListingListRow[] = (rows ?? []).map((r) => ({
    id: r.id,
    ebay_sku: r.ebay_sku,
    ebay_listing_id: r.ebay_listing_id,
    title: r.title,
    list_price:
      typeof r.list_price === 'string' ? r.list_price : String(r.list_price),
    currency: r.currency,
    format: r.format,
    status: r.status,
    view_count: r.view_count,
    watcher_count: r.watcher_count,
    last_synced_at: r.last_synced_at,
    inventory_item_id: r.inventory_item_id,
  }))

  return <EbayListingsListContent rows={list} status={status} />
}
