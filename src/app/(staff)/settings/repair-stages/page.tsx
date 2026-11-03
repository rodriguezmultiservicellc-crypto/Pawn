import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { createAdminClient } from '@/lib/supabase/admin'
import RepairStagesContent, { type StageEditRow, type StagesByTypeView } from './content'
import type { RepairStatus, ServiceType } from '@/types/database-aliases'

const SETTINGS_ROLES = new Set(['owner', 'chain_admin', 'manager'])

/**
 * /settings/repair-stages — the customer-facing stages per service type
 * (patches/0061) and the "text the customer when ready" switch.
 */
export default async function RepairStagesPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  if (!ctx.tenantRole || !SETTINGS_ROLES.has(ctx.tenantRole)) {
    redirect('/dashboard')
  }

  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_repair')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  if (!tenant?.has_repair) redirect('/settings')

  const admin = createAdminClient()
  const [stagesRes, settingsRes] = await Promise.all([
    admin
      .from('repair_stages')
      .select('id, service_type, sort_order, name_en, name_es, percent, maps_to_statuses, is_active')
      .eq('tenant_id', ctx.tenantId)
      .order('service_type')
      .order('sort_order'),
    admin
      .from('settings')
      .select('repair_ready_auto_notify')
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle(),
  ])

  const byType: StagesByTypeView = {}
  for (const r of stagesRes.data ?? []) {
    const row: StageEditRow = {
      id: r.id,
      name_en: r.name_en,
      name_es: r.name_es,
      percent: r.percent,
      maps_to_statuses: (r.maps_to_statuses ?? []) as RepairStatus[],
      is_active: r.is_active,
    }
    const type = r.service_type as ServiceType
    byType[type] = [...(byType[type] ?? []), row]
  }

  return (
    <RepairStagesContent
      stagesByType={byType}
      autoNotify={settingsRes.data?.repair_ready_auto_notify === true}
    />
  )
}
