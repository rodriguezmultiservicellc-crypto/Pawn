'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  House,
  Users,
  Package,
  Coins,
  Wrench,
  CashRegister,
  ChartBar,
  Shield,
  UsersThree,
  Gear,
  ClockCounterClockwise,
  ArrowsLeftRight,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import type { TenantRole, TenantType } from '@/types/database-aliases'

/**
 * Staff sidebar. Module entries (Pawn / Repair / POS) render only when the
 * active tenant has the matching module enabled. Server-side proxy + RLS
 * are the actual gates — the sidebar just hides what the user can't reach.
 *
 * Phase 1 routes shipping: /dashboard, /customers, /inventory.
 * Phase 2+ routes show as disabled placeholders so the layout doesn't shift
 * when modules come online.
 */

type Modules = {
  has_pawn: boolean
  has_repair: boolean
  has_retail: boolean
}

type Tenant = {
  tenant_type: TenantType | null
  parent_tenant_id: string | null
}

const AUDIT_ROLES = new Set<TenantRole>(['owner', 'manager', 'chain_admin'])

export function Sidebar({
  modules,
  tenantRole,
  tenant,
}: {
  modules: Modules
  tenantRole: TenantRole | null
  tenant?: Tenant
}) {
  const { t } = useI18n()
  const pathname = usePathname()
  const canSeeAudit = !!tenantRole && AUDIT_ROLES.has(tenantRole)
  // Inventory transfers: only visible to chain branches (a 'shop' with a
  // parent_tenant_id). Standalone shops have no siblings; chain HQs don't
  // hold inventory in v1.
  const canSeeTransfers =
    tenant?.tenant_type === 'shop' && !!tenant.parent_tenant_id

  const items: Array<{
    href: string
    label: string
    icon: React.ReactNode
    disabled?: boolean
    visible?: boolean
  }> = [
    {
      href: '/dashboard',
      label: t.nav.dashboard,
      icon: <House size={18} weight="regular" />,
    },
    {
      href: '/customers',
      label: t.nav.customers,
      icon: <Users size={18} weight="regular" />,
    },
    {
      href: '/inventory',
      label: t.nav.inventory,
      icon: <Package size={18} weight="regular" />,
    },
    {
      href: '/inventory/transfers',
      label: t.nav.transfers,
      icon: <ArrowsLeftRight size={18} weight="regular" />,
      visible: canSeeTransfers,
    },
    {
      href: '/pawn',
      label: t.nav.pawn,
      icon: <Coins size={18} weight="regular" />,
      visible: modules.has_pawn,
    },
    {
      href: '/repair',
      label: t.nav.repair,
      icon: <Wrench size={18} weight="regular" />,
      visible: modules.has_repair,
    },
    {
      href: '/pos',
      label: t.nav.pos,
      icon: <CashRegister size={18} weight="regular" />,
      visible: modules.has_retail,
    },
    {
      href: '/reports',
      label: t.nav.reports,
      icon: <ChartBar size={18} weight="regular" />,
      disabled: true,
    },
    {
      href: '/compliance',
      label: t.nav.compliance,
      icon: <Shield size={18} weight="regular" />,
      disabled: true,
    },
    {
      href: '/audit',
      label: t.nav.audit,
      icon: <ClockCounterClockwise size={18} weight="regular" />,
      visible: canSeeAudit,
    },
    {
      href: '/team',
      label: t.nav.team,
      icon: <UsersThree size={18} weight="regular" />,
      disabled: true,
    },
    {
      href: '/settings',
      label: t.nav.settings,
      icon: <Gear size={18} weight="regular" />,
      disabled: true,
    },
  ]

  return (
    <nav className="flex w-56 shrink-0 flex-col gap-0.5 border-r border-hairline bg-canvas px-2 py-4">
      {items
        .filter((it) => it.visible !== false)
        .map((it) => {
          const isActive =
            pathname === it.href || pathname.startsWith(it.href + '/')
          if (it.disabled) {
            return (
              <span
                key={it.href}
                className="flex cursor-not-allowed items-center gap-2 rounded-md px-3 py-2 text-sm text-ash/60"
                aria-disabled
                title={`${it.label} — coming soon`}
              >
                <span className="text-ash/60">{it.icon}</span>
                <span className="truncate">{it.label}</span>
              </span>
            )
          }
          return (
            <Link
              key={it.href}
              href={it.href}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                isActive
                  ? 'bg-cloud font-medium text-ink'
                  : 'text-ink/80 hover:bg-cloud'
              }`}
            >
              <span className={isActive ? 'text-rausch' : 'text-ash'}>
                {it.icon}
              </span>
              <span className="truncate">{it.label}</span>
            </Link>
          )
        })}
    </nav>
  )
}
