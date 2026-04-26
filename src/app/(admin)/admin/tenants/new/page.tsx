import { requireSuperAdmin } from '@/lib/supabase/guards'
import NewTenantForm, { type ChainParentOption } from './form'

export default async function NewTenantPage() {
  const { admin } = await requireSuperAdmin()

  // Pre-fetch chain_hq tenants so the parent picker is available without a
  // round-trip when the user picks tenant_type=shop.
  const { data: parents } = await admin
    .from('tenants')
    .select('id, name, dba')
    .eq('tenant_type', 'chain_hq')
    .order('name')

  const parentOptions: ChainParentOption[] = (parents ?? []).map((p) => ({
    id: p.id,
    label: (p.dba || p.name) ?? '—',
  }))

  return <NewTenantForm parentOptions={parentOptions} />
}
