'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireSuperAdmin } from '@/lib/supabase/guards'
import { checkPlanFeature, countChildTenants, checkPlanLimit } from '@/lib/saas/gates'
import type {
  PoliceReportFormat,
  TenantType,
} from '@/types/database-aliases'

export type CreateTenantState = {
  error?: string
  fieldErrors?: Record<string, string>
  ok?: { tenantId: string; licenseKey: string; name: string }
}

const VALID_TENANT_TYPES: ReadonlyArray<TenantType> = [
  'chain_hq',
  'shop',
  'standalone',
]

const VALID_POLICE_FORMATS: ReadonlyArray<PoliceReportFormat> = [
  'fl_leadsonline',
]

function getString(formData: FormData, key: string): string {
  const v = formData.get(key)
  return typeof v === 'string' ? v.trim() : ''
}

function getBool(formData: FormData, key: string): boolean {
  return formData.get(key) === 'on'
}

export async function createTenantAction(
  _prev: CreateTenantState,
  formData: FormData,
): Promise<CreateTenantState> {
  const { admin, userId } = await requireSuperAdmin()

  const name = getString(formData, 'name')
  if (!name) {
    return { fieldErrors: { name: 'required' } }
  }

  const tenantTypeRaw = getString(formData, 'tenant_type') || 'standalone'
  if (!VALID_TENANT_TYPES.includes(tenantTypeRaw as TenantType)) {
    return { fieldErrors: { tenant_type: 'invalid' } }
  }
  const tenantType = tenantTypeRaw as TenantType

  const parentTenantIdRaw = getString(formData, 'parent_tenant_id')
  const parentTenantId =
    tenantType === 'shop' && parentTenantIdRaw ? parentTenantIdRaw : null

  if (tenantType === 'shop' && !parentTenantId) {
    return { fieldErrors: { parent_tenant_id: 'required_for_shop' } }
  }

  const policeFormatRaw =
    getString(formData, 'police_report_format') || 'fl_leadsonline'
  if (
    !VALID_POLICE_FORMATS.includes(policeFormatRaw as PoliceReportFormat)
  ) {
    return { fieldErrors: { police_report_format: 'invalid' } }
  }
  const policeFormat = policeFormatRaw as PoliceReportFormat

  // Plan-tier gates for chain creation. Only fires when adding a new
  // `shop` under an existing chain_hq parent — single standalone tenants
  // and the chain_hq tenants themselves don't need the multi_shop feature.
  // Bypass for the override flag so superadmin support flows can ignore
  // the limit when needed.
  const overrideGate = getBool(formData, 'override_plan_gate')
  if (tenantType === 'shop' && parentTenantId && !overrideGate) {
    const featureCheck = await checkPlanFeature(parentTenantId, 'multi_shop')
    if (!featureCheck.allowed) {
      return {
        error: `plan_gate:multi_shop_unavailable:${featureCheck.planCode ?? '—'}`,
      }
    }
    const childCount = await countChildTenants(parentTenantId)
    const limitCheck = await checkPlanLimit(
      parentTenantId,
      'max_locations',
      childCount + 1, // pass the post-create count so we error at the limit
    )
    if (!limitCheck.allowed) {
      return {
        error: `plan_limit_reached:max_locations:${limitCheck.current}/${limitCheck.limit ?? 0}:${limitCheck.planCode ?? '—'}`,
      }
    }
  }

  const { data, error } = await admin.rpc('create_tenant_with_owner', {
    p_name: name,
    p_superadmin_user_id: userId,
    p_parent_tenant_id: parentTenantId ?? undefined,
    p_tenant_type: tenantType,
    p_dba: getString(formData, 'dba') || undefined,
    p_address: getString(formData, 'address') || undefined,
    p_city: getString(formData, 'city') || undefined,
    p_state: getString(formData, 'state') || 'FL',
    p_zip: getString(formData, 'zip') || undefined,
    p_phone: getString(formData, 'phone') || undefined,
    p_email: getString(formData, 'email') || undefined,
    p_has_pawn: getBool(formData, 'has_pawn'),
    p_has_repair: getBool(formData, 'has_repair'),
    p_has_retail: getBool(formData, 'has_retail'),
    p_police_report_format: policeFormat,
  })

  if (error) {
    return { error: error.message }
  }

  // RPC returns SETOF (tenant_id, license_key) — normalize.
  const row = Array.isArray(data) ? data[0] : data
  const tenantId = (row as { tenant_id: string } | null)?.tenant_id
  const licenseKey = (row as { license_key: string } | null)?.license_key

  if (!tenantId || !licenseKey) {
    return { error: 'create_tenant_with_owner returned no row' }
  }

  revalidatePath('/admin/tenants')

  redirect(
    `/admin/tenants?created=${tenantId}&license=${encodeURIComponent(
      licenseKey,
    )}&name=${encodeURIComponent(name)}`,
  )
}
