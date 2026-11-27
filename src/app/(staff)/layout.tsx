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
import { StaffTopBarActions } from '@/components/layout/StaffTopBarActions'

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
    .select(
      'id, name, dba, tenant_type, parent_tenant_id, has_pawn, has_repair, has_retail',
    )
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

  const sidebarTenant = activeTenant
    ? {
        tenant_type: activeTenant.tenant_type,
        parent_tenant_id: activeTenant.parent_tenant_id,
      }
    : undefined

  const { data: profile } = await ctx.supabase
    .from('profiles')
    .select('language, full_name')
    .eq('id', ctx.userId)
    .maybeSingle()

  const initialLang = isLanguage(profile?.language) ? profile.language : 'en'

  // Consignment is a per-tenant module gate in `settings`, not a column on
  // `tenants` — it rides on top of inventory rather than being a surface of
  // its own (same reasoning as loyalty, patches/0028).
  const { data: tenantSettings } = ctx.tenantId
    ? await ctx.supabase
        .from('settings')
        .select('consignment_enabled')
        .eq('tenant_id', ctx.tenantId)
        .maybeSingle()
    : { data: null }

  return (
    <I18nProvider initialLang={initialLang}>
      <div className="flex min-h-screen bg-background">
        <Sidebar
          modules={modules}
          tenantRole={ctx.tenantRole}
          tenant={sidebarTenant}
          consignmentEnabled={tenantSettings?.consignment_enabled === true}
        />
        {/* min-w-0: a wide page (a table) scrolls inside <main>, it never
            pushes the whole shell past the screen on a phone. */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="h-16 border-b border-border bg-card">
            <div className="flex h-full items-center justify-between gap-2 px-3 sm:px-6">
              <div className="flex min-w-0 items-center gap-3">
                <Link
                  href="/dashboard"
                  className="hidden shrink-0 font-display text-xl font-bold text-navy sm:inline"
                >
                  Sol Pawn
                </Link>
                <span className="hidden text-muted sm:inline">·</span>
                <TenantSwitcher
                  tenants={switcherTenants}
                  activeTenantId={ctx.tenantId}
                />
              </div>
              <div className="flex shrink-0 items-center gap-2 text-sm sm:gap-4">
                {ctx.globalRole === 'superadmin' ? (
                  <Link
                    href="/admin/tenants"
                    className="inline-flex items-center gap-1 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted transition-all hover:bg-background hover:text-foreground"
                  >
                    <span className="rounded-full bg-navy px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                      Admin
                    </span>
                    <span className="hidden sm:inline">Console</span>
                  </Link>
                ) : null}
                <StaffTopBarActions
                  userName={profile?.full_name ?? ctx.email ?? ''}
                />
              </div>
            </div>
          </header>
          <main className="min-w-0 flex-1 overflow-x-auto px-3 py-4 sm:px-6 sm:py-6">{children}</main>
        </div>
      </div>
    </I18nProvider>
  )
}
