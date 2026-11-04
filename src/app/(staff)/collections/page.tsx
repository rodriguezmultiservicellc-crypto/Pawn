import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadTenantRules } from '@/lib/jurisdictions/load'
import { todayInTimezone } from '@/lib/jurisdictions/rules'
import { loadCollections } from '@/lib/collections/load'
import CollectionsContent from './content'

export const dynamic = 'force-dynamic'

/**
 * Collections (brief Phase 4.3): everyone who owes the shop money, from
 * every source, with configurable aging buckets and the KPIs the brief
 * lists. Read-only — every action on a row goes through the existing
 * flow (loan detail, layaway detail, repair ticket, reminder dialog).
 */
export default async function CollectionsPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  const { supabase } = await requireRoleInTenant(ctx.tenantId, [
    'owner',
    'manager',
    'pawn_clerk',
    'chain_admin',
  ])

  const rules = await loadTenantRules(createAdminClient(), ctx.tenantId)
  const today = todayInTimezone(rules.timezone)
  const data = await loadCollections({ client: supabase, tenantId: ctx.tenantId, today })

  return <CollectionsContent data={data} today={today} />
}
