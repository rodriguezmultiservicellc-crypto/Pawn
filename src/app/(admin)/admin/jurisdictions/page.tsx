import { requireSuperAdmin } from '@/lib/supabase/guards'
import { JURISDICTION_COLUMNS } from '@/lib/jurisdictions/load'
import { toJurisdiction } from '@/lib/jurisdictions/rules'
import JurisdictionsListContent from './content'

/** /admin/jurisdictions — superadmin list of statutory rule sets. */
export default async function JurisdictionsAdminPage() {
  const { admin } = await requireSuperAdmin()

  const [{ data: rows }, { data: tenants }] = await Promise.all([
    admin
      .from('jurisdictions')
      .select(`${JURISDICTION_COLUMNS}, is_active`)
      .order('country')
      .order('name'),
    admin.from('tenants').select('jurisdiction_code'),
  ])

  const tenantCounts: Record<string, number> = {}
  for (const t of tenants ?? []) {
    if (t.jurisdiction_code) {
      tenantCounts[t.jurisdiction_code] = (tenantCounts[t.jurisdiction_code] ?? 0) + 1
    }
  }

  return (
    <JurisdictionsListContent
      rows={(rows ?? []).map((r) => ({
        ...toJurisdiction(r),
        is_active: r.is_active,
        tenantCount: tenantCounts[r.code] ?? 0,
      }))}
    />
  )
}
