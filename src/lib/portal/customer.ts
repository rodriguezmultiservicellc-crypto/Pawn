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
    .eq('auth_user_id', ctx.userId)
    .is('deleted_at', null)
    .maybeSingle()
  const customer = (lookup.data ?? null) as CustomerRow | null

  if (!customer) redirect('/no-tenant')

  // Defense in depth: confirm the user holds an active client membership at
  // the customer's tenant. Without this, a stale customers row could expose
  // tenant A's data to a user whose only current client membership is at
  // tenant B (e.g. former customer relinked to a new shop). The proxy
  // verified `tenantRole === 'client'` against the active-tenant cookie,
  // not against customer.tenant_id.
  const { data: membership } = await admin
    .from('user_tenants')
    .select('role')
    .eq('user_id', ctx.userId)
    .eq('tenant_id', customer.tenant_id)
    .eq('role', 'client')
    .eq('is_active', true)
    .maybeSingle()

  if (!membership) redirect('/no-tenant')

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
