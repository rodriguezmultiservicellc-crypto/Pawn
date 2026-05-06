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

  return (
    <I18nProvider initialLang={initialLang}>
      <div className="flex min-h-screen bg-background">
        <Sidebar
          modules={modules}
          tenantRole={ctx.tenantRole}
          tenant={sidebarTenant}
        />
        <div className="flex flex-1 flex-col">
          <header className="h-16 border-b border-border bg-card">
            <div className="flex h-full items-center justify-between px-6">
              <div className="flex items-center gap-3">
                <Link
                  href="/dashboard"
                  className="font-display text-xl font-bold text-navy"
                >
                  Pawn
                </Link>
                <span className="text-muted">·</span>
                <TenantSwitcher
                  tenants={switcherTenants}
                  activeTenantId={ctx.tenantId}
                />
              </div>
              <div className="flex items-center gap-4 text-sm">
                {ctx.globalRole === 'superadmin' ? (
                  <Link
                    href="/admin/tenants"
                    className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted transition-all hover:bg-background hover:text-foreground"
                  >
                    <span className="rounded-full bg-navy px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                      Admin
                    </span>
                    <span>Console</span>
                  </Link>
                ) : null}
                <span className="text-text-secondary">
                  {profile?.full_name ?? ctx.email}
                </span>
              </div>
            </div>
          </header>
          <main className="flex-1 overflow-x-auto px-6 py-6">{children}</main>
        </div>
      </div>
    </I18nProvider>
  )
}
