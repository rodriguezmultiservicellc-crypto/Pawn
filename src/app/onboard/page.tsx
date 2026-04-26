import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import OnboardContent from './content'

type SearchParams = Promise<{ token?: string }>

/**
 * /onboard?token=<license_key>
 *
 * Public path (declared in proxy.ts PUBLIC_PATHS) — but we still require
 * authentication to actually claim. Unauth users are bounced to /login
 * with `?next=` preserving the onboarding URL so they come back here
 * after sign-in.
 *
 * The license_key acts as a bearer secret. We look the tenant up via the
 * admin client server-side because the user isn't yet a member, so the
 * RLS policy on `tenants` would otherwise hide it. The token is in the URL
 * — anyone with the link sees the tenant's name. That's the intended
 * trade-off (you give the link to your new owner; if it leaks, anyone who
 * gets it can also become the owner). The RPC consumes the key on first
 * claim, so a leaked link only works once.
 */
export default async function OnboardPage(props: {
  searchParams: SearchParams
}) {
  const params = await props.searchParams
  const token = typeof params.token === 'string' ? params.token : null

  // Require authentication. Bounce unauth → /login with this URL preserved.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    const next = `/onboard${token ? `?token=${encodeURIComponent(token)}` : ''}`
    redirect(`/login?next=${encodeURIComponent(next)}`)
  }

  // No token in URL — render an "invalid" state.
  if (!token) {
    return (
      <OnboardContent token={null} tenantName={null} />
    )
  }

  // Look up the tenant by license_key (admin client — bypass RLS so we can
  // show the tenant name before the user is a member).
  const admin = createAdminClient()
  const { data: tenant } = await admin
    .from('tenants')
    .select('id, name, dba, is_active')
    .eq('license_key', token)
    .maybeSingle()

  const tenantName =
    tenant && tenant.is_active ? (tenant.dba || tenant.name) : null

  return <OnboardContent token={token} tenantName={tenantName} />
}
