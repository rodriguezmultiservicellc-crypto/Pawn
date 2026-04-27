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
import { Sidebar } from '@/components/layout/Sidebar'

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
 * Wraps in I18nProvider seeded from profiles.language. Renders a sidebar
 * gated by the active tenant's module flags, and a top bar with the
 * tenant switcher.
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

  // Accessible tenants for the switcher. RLS filters to direct memberships
  // + chain-admin children. We also need the active tenant's module flags
  // for the sidebar.
  const { data: accessibleTenants } = await ctx.supabase
    .from('tenants')
    .select('id, name, dba, tenant_type, has_pawn, has_repair, has_retail')
    .order('name')

  const tenantsList = accessibleTenants ?? []
  const switcherTenants = tenantsList as SwitcherTenant[]

  const activeTenant = ctx.tenantId
    ? tenantsList.find((t) => t.id === ctx.tenantId) ?? null
    : null

  const modules = {
    has_pawn: activeTenant?.has_pawn ?? false,
    has_repair: activeTenant?.has_repair ?? false,
    has_retail: activeTenant?.has_retail ?? false,
  }

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
          <div className="flex items-center justify-between px-6 py-3">
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
        <div className="flex flex-1">
          <Sidebar modules={modules} />
          <main className="flex-1 overflow-x-auto px-6 py-6">{children}</main>
        </div>
      </div>
    </I18nProvider>
  )
}
