import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { createAdminClient } from '@/lib/supabase/admin'
import MarketDataContent from './content'

/**
 * /admin/market-data — superadmin-only cross-tenant pricing aggregation
 * search. See patches/0036 for the warehouse design rationale.
 */
export default async function MarketDataPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (ctx.globalRole !== 'superadmin') redirect('/no-tenant')

  const admin = createAdminClient()

  // Quick warehouse-status snapshot for the admin so they know if data
  // is flowing in / how much is pending embedding.
  // Boundary cast: market_data_points lands in generated types only
  // after `npm run db:types` runs post-migration 0036.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mdp = (admin.from as any)('market_data_points')
  const [
    { count: totalRows },
    { count: pendingEmbed },
    { count: lastDayRows },
  ] = await Promise.all([
    mdp.select('id', { count: 'exact', head: true }),
    mdp.select('id', { count: 'exact', head: true }).is('item_embedding', null),
    mdp
      .select('id', { count: 'exact', head: true })
      .gte(
        'created_at',
        // eslint-disable-next-line react-hooks/purity
        new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      ),
  ])

  return (
    <MarketDataContent
      stats={{
        totalRows: totalRows ?? 0,
        pendingEmbed: pendingEmbed ?? 0,
        lastDayRows: lastDayRows ?? 0,
      }}
    />
  )
}
