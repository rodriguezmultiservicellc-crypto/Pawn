import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { getCtx } from '@/lib/supabase/ctx'
import { I18nProvider } from '@/lib/i18n/context'
import { isLanguage } from '@/lib/i18n/config'
import {
  TenantSwitcher,
  type SwitcherTenant,
} from '@/components/layout/TenantSwitcher'

const STAFF_ROLES = new Set([
  'owner',
  'chain_admin',
  'manager',
  'pawn_clerk',
  'repair_tech',
  'appraiser',
])

/**
 * Staff route group. Defense-in-depth role check (proxy already gated).
 * Wraps in I18nProvider seeded from profiles.language. Renders a tenant
 * switcher in the top bar — RLS on `tenants` filters the list to the
 * accessible set (direct memberships + chain admin children).
 */
export default async function StaffLayout({
  children,
}: {
  children: ReactNode
}) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantRole || !STAFF_ROLES.has(ctx.tenantRole)) {
    redirect('/no-tenant')
  }

  // Accessible tenants for the switcher. RLS handles the filtering — we
  // get back direct memberships AND children of any chain HQ where the
  // user is chain_admin.
  const { data: accessibleTenants } = await ctx.supabase
    .from('tenants')
    .select('id, name, dba, tenant_type')
    .order('name')

  const switcherTenants = (accessibleTenants ?? []) as SwitcherTenant[]

  const { data: profile } = await ctx.supabase
    .from('profiles')
    .select('language, full_name')
    .eq('id', ctx.userId)
    .maybeSingle()

  const initialLang = isLanguage(profile?.language) ? profile.language : 'en'

  return (
    <I18nProvider initialLang={initialLang}>
      <div className="flex min-h-screen flex-col bg-cloud">
        <header className="border-b border-hairline bg-canvas">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <Link href="/dashboard" className="flex items-center gap-2">
                <span
                  className="bg-clip-text text-lg font-bold text-transparent"
                  style={{
                    backgroundImage:
                      'linear-gradient(90deg, #ff385c 0%, #e00b41 50%, #92174d 100%)',
                  }}
                >
                  Pawn
                </span>
              </Link>
              <span className="text-ash">·</span>
              <TenantSwitcher
                tenants={switcherTenants}
                activeTenantId={ctx.tenantId}
              />
            </div>
            <div className="flex items-center gap-4 text-sm">
              <span className="text-ash">
                {profile?.full_name ?? ctx.email}
              </span>
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
          {children}
        </main>
      </div>
    </I18nProvider>
  )
}
