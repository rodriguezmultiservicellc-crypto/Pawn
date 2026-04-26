import { requireSuperAdmin } from '@/lib/supabase/guards'
import TenantsContent, { type TenantRow } from './content'

type SearchParams = Promise<{
  created?: string
  license?: string
  name?: string
}>

export default async function AdminTenantsPage(props: {
  searchParams: SearchParams
}) {
  const { admin } = await requireSuperAdmin()
  const params = await props.searchParams

  const { data: tenants } = await admin
    .from('tenants')
    .select(
      'id, name, dba, tenant_type, has_pawn, has_repair, has_retail, parent_tenant_id, is_active, created_at',
    )
    .order('created_at', { ascending: false })

  const flash =
    params.created && params.license && params.name
      ? {
          tenantId: params.created,
          licenseKey: params.license,
          tenantName: params.name,
        }
      : null

  return (
    <TenantsContent
      tenants={(tenants ?? []) as TenantRow[]}
      flash={flash}
    />
  )
}
