import 'server-only'
import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Resolve the active client's customer row + tenant. Used by /portal pages
 * (server components) where we want to render the customer's data.
 *
 * Behavior:
 *   - Unauthenticated → redirect /login.
 *   - Authenticated but tenantRole !== 'client' → /no-tenant.
 *   - Authenticated client but no customers row linked via auth_user_id →
 *     /no-tenant. (This shouldn't happen post-onboarding; the portal-invite
 *     flow links the customers row before granting client membership.)
 */
export async function resolvePortalCustomer(): Promise<{
  userId: string
  tenantId: string
  customerId: string
  customerEmail: string | null
  customerLanguage: 'en' | 'es' | null
  customerName: string | null
}> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (ctx.tenantRole !== 'client') redirect('/no-tenant')

  // Use admin client for the auth_user_id lookup. The column ships in 0009;
  // cast eq() so TS doesn't choke until db:types regenerates.
  const admin = createAdminClient()
  type CustomerRow = {
    id: string
    tenant_id: string
    email: string | null
    language: string | null
    first_name: string | null
    last_name: string | null
  }
  const lookup = await admin
    .from('customers')
    .select('id, tenant_id, email, language, first_name, last_name')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .eq('auth_user_id' as any, ctx.userId)
    .is('deleted_at', null)
    .maybeSingle()
  const customer = (lookup.data ?? null) as CustomerRow | null

  if (!customer) redirect('/no-tenant')
  if (ctx.tenantId && customer.tenant_id !== ctx.tenantId) {
    // Ctx tenant disagrees with customer's tenant — prefer the customer's.
    // The proxy bases its decisions on tenantRole, which we already
    // verified above.
  }

  const fullName =
    customer.first_name || customer.last_name
      ? [customer.first_name, customer.last_name].filter(Boolean).join(' ')
      : null

  return {
    userId: ctx.userId,
    tenantId: customer.tenant_id,
    customerId: customer.id,
    customerEmail: customer.email,
    customerLanguage:
      customer.language === 'en' || customer.language === 'es'
        ? customer.language
        : null,
    customerName: fullName,
  }
}
