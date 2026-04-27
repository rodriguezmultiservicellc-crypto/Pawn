import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import DashboardContent, { type RecentCustomer, type RecentItem } from './content'

export default async function DashboardPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  // Counts via head=true + count='exact' so no rows are returned, just totals.
  // RLS already gates each query to the tenant.
  const [
    { count: customerCount },
    { count: bannedCount },
    { count: inventoryCount },
    { count: heldCount },
    { data: recentCustomers },
    { data: recentItems },
  ] = await Promise.all([
    ctx.supabase
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null),
    ctx.supabase
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .eq('is_banned', true),
    ctx.supabase
      .from('inventory_items')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .eq('status', 'available'),
    ctx.supabase
      .from('inventory_items')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .eq('status', 'held'),
    ctx.supabase
      .from('customers')
      .select('id, first_name, last_name, phone, created_at')
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(5),
    ctx.supabase
      .from('inventory_items')
      .select('id, sku, description, status, list_price, created_at')
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  return (
    <DashboardContent
      customerCount={customerCount ?? 0}
      bannedCount={bannedCount ?? 0}
      inventoryCount={inventoryCount ?? 0}
      heldCount={heldCount ?? 0}
      recentCustomers={(recentCustomers ?? []) as RecentCustomer[]}
      recentItems={(recentItems ?? []) as RecentItem[]}
    />
  )
}
