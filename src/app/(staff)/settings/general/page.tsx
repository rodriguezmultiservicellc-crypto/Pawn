import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { createAdminClient } from '@/lib/supabase/admin'
import GeneralSettingsContent from './content'

const SETTINGS_ROLES = new Set(['owner', 'chain_admin'])

/**
 * /settings/general — tenant identity + contact + module gates.
 *
 * Owner / chain_admin only (matches who can re-trigger Stripe Connect /
 * change billing — the same blast radius as renaming the shop or
 * disabling a module). Manager can VIEW from the hub but not edit here.
 */
export default async function GeneralSettingsPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  if (!ctx.tenantRole || !SETTINGS_ROLES.has(ctx.tenantRole)) {
    redirect('/settings')
  }

  const admin = createAdminClient()
  const { data: tenant } = await admin
    .from('tenants')
    .select(
      'id, name, dba, address, city, state, zip, phone, email, has_pawn, has_repair, has_retail, tenant_type, parent_tenant_id, police_report_format, agency_store_id, public_slug, public_landing_enabled, public_about, public_hours',
    )
    .eq('id', ctx.tenantId)
    .maybeSingle<{
      id: string
      name: string
      dba: string | null
      address: string | null
      city: string | null
      state: string | null
      zip: string | null
      phone: string | null
      email: string | null
      has_pawn: boolean
      has_repair: boolean
      has_retail: boolean
      tenant_type: string
      parent_tenant_id: string | null
      police_report_format: string | null
      agency_store_id: string | null
      public_slug: string | null
      public_landing_enabled: boolean | null
      public_about: string | null
      public_hours: unknown
    }>()

  if (!tenant) redirect('/settings')

  return (
    <GeneralSettingsContent
      tenant={{
        id: tenant.id,
        name: tenant.name,
        dba: tenant.dba,
        address: tenant.address,
        city: tenant.city,
        state: tenant.state,
        zip: tenant.zip,
        phone: tenant.phone,
        email: tenant.email,
        has_pawn: tenant.has_pawn,
        has_repair: tenant.has_repair,
        has_retail: tenant.has_retail,
        tenant_type: tenant.tenant_type,
        parent_tenant_id: tenant.parent_tenant_id,
        police_report_format: tenant.police_report_format,
        agency_store_id: tenant.agency_store_id,
        public_slug: tenant.public_slug,
        public_landing_enabled: tenant.public_landing_enabled ?? false,
        public_about: tenant.public_about,
        public_hours: tenant.public_hours,
      }}
    />
  )
}
