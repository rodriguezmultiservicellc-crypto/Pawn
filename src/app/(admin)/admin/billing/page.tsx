import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { getActivePlans } from '@/lib/saas/plans'
import { listTenantBilling } from '@/lib/saas/subscriptions'
import BillingContent from './content'

/**
 * /admin/billing — superadmin-only platform billing console.
 *
 * Lists every tenant alongside their current subscription + plan. Lets the
 * operator manually assign a plan (used during the trial-period transition
 * before platform Stripe is wired). Once the SaaS Stripe webhook lands,
 * webhook events are the source of truth — this page becomes read-only
 * for everything except `internal_notes`.
 */
export default async function AdminBillingPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (ctx.globalRole !== 'superadmin') redirect('/no-tenant')

  const [rows, plans] = await Promise.all([
    listTenantBilling(),
    getActivePlans(),
  ])

  return <BillingContent rows={rows} plans={plans} />
}
