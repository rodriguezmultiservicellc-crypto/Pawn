import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  defaultCommissionPct,
  isConsignmentEnabled,
  loadConsignorOptions,
} from '@/lib/consignment/payables'
import NewInventoryItemForm from './form'

export default async function NewInventoryItemPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  // Consignment block on the form (patches/0054) — the consignor picker
  // needs the tenant's active consignors, and the commission field seeds
  // from the shop default.
  const admin = createAdminClient()
  const consignmentEnabled = await isConsignmentEnabled(admin, ctx.tenantId)
  const [consignors, commissionPct] = consignmentEnabled
    ? await Promise.all([
        loadConsignorOptions(admin, ctx.tenantId),
        defaultCommissionPct(admin, ctx.tenantId),
      ])
    : [[], 0.2]

  return (
    <NewInventoryItemForm
      consignmentEnabled={consignmentEnabled}
      consignors={consignors}
      defaultCommissionPct={commissionPct}
    />
  )
}
