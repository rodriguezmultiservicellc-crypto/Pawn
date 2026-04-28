'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  House,
  Users,
  Package,
  Coins,
  Scales,
  Wrench,
  CashRegister,
  ChartBar,
  Shield,
  UsersThree,
  Gear,
  ClockCounterClockwise,
  ArrowsLeftRight,
  ChatCircleText,
  Certificate,
  CaretDoubleLeft,
  CaretDoubleRight,
  Storefront,
  CreditCard,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import type { TenantRole, TenantType } from '@/types/database-aliases'

/**
 * Staff sidebar. Module entries (Pawn / Repair / POS) render only when the
 * active tenant has the matching module enabled. Server-side proxy + RLS
 * are the actual gates — the sidebar just hides what the user can't reach.
 *
 * Collapse behavior:
 *   - User-toggled via the caret button at the top; choice persists in
 *     localStorage under `pawn.sidebar.collapsed`.
 *   - Phone-size viewport (≤800px) auto-collapses regardless of the
 *     persisted preference, restoring the user's choice when crossing
 *     back to desktop.
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
const SETTINGS_ROLES = new Set<TenantRole>(['owner', 'manager', 'chain_admin'])
const BILLING_ROLES = new Set<TenantRole>(['owner', 'chain_admin'])

const MOBILE_QUERY = '(max-width: 800px)'
const STORAGE_KEY = 'pawn.sidebar.collapsed'

function readPersistedCollapsed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (window.matchMedia(MOBILE_QUERY).matches) return true
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function readUserPreference(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

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
  const [collapsed, setCollapsed] = useState<boolean>(() =>
    readPersistedCollapsed(),
  )

  // Auto-collapse on phone viewports; restore user preference on resize-up.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mql = window.matchMedia(MOBILE_QUERY)
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setCollapsed(true)
      else setCollapsed(readUserPreference())
    }
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
      } catch {}
      return next
    })
  }

  const canSeeAudit = !!tenantRole && AUDIT_ROLES.has(tenantRole)
  const canSeeSettings = !!tenantRole && SETTINGS_ROLES.has(tenantRole)
  const canSeeBilling = !!tenantRole && BILLING_ROLES.has(tenantRole)
  const canSeeTransfers =
    tenant?.tenant_type === 'shop' && !!tenant.parent_tenant_id

  const items: Array<{
    href: string
    label: string
    icon: React.ReactNode
    disabled?: boolean
    visible?: boolean
  }> = [
    { href: '/dashboard', label: t.nav.dashboard, icon: <House size={18} weight="regular" /> },
    { href: '/customers', label: t.nav.customers, icon: <Users size={18} weight="regular" /> },
    { href: '/inventory', label: t.nav.inventory, icon: <Package size={18} weight="regular" /> },
    {
      href: '/inventory/transfers',
      label: t.nav.transfers,
      icon: <ArrowsLeftRight size={18} weight="regular" />,
      visible: canSeeTransfers,
    },
    // eBay listings — under Inventory because the listings ARE inventory
    // items being published. Settings/integrations entry is owner-only and
    // users will navigate there from the per-listing UI.
    {
      href: '/inventory/listings/ebay',
      label: t.nav.ebayListings,
      icon: <Storefront size={18} weight="regular" />,
      visible: modules.has_retail,
    },
    {
      href: '/inventory/spot-prices',
      label: t.nav.spotPrices,
      icon: <Scales size={18} weight="regular" />,
      visible: canSeeSettings || modules.has_pawn || modules.has_retail,
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
      href: '/appraisals',
      label: t.nav.appraisals,
      icon: <Certificate size={18} weight="regular" />,
    },
    { href: '/reports', label: t.nav.reports, icon: <ChartBar size={18} weight="regular" /> },
    {
      href: '/reports/police-report',
      label: t.nav.compliance,
      icon: <Shield size={18} weight="regular" />,
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
      href: '/settings/communications',
      label: t.nav.communications,
      icon: <ChatCircleText size={18} weight="regular" />,
      visible: canSeeSettings,
    },
    {
      href: '/billing',
      label: t.nav.billing,
      icon: <CreditCard size={18} weight="regular" />,
      visible: canSeeBilling,
    },
    {
      href: '/settings',
      label: t.nav.settings,
      icon: <Gear size={18} weight="regular" />,
      disabled: true,
    },
  ]

  const widthClass = collapsed ? 'w-14' : 'w-56'
  const itemPadX = collapsed ? 'px-0 justify-center' : 'px-3'

  return (
    <nav
      className={`flex ${widthClass} shrink-0 flex-col gap-0.5 border-r border-hairline bg-canvas px-2 py-4 transition-[width] duration-150`}
      aria-label="Primary"
    >
      <button
        type="button"
        onClick={toggle}
        className="mb-2 flex h-8 items-center justify-center rounded-md text-ash hover:bg-cloud hover:text-ink focus:outline-none focus:ring-2 focus:ring-rausch/50"
        title={collapsed ? t.common.expandSidebar : t.common.collapseSidebar}
        aria-label={collapsed ? t.common.expandSidebar : t.common.collapseSidebar}
        aria-expanded={!collapsed}
      >
        {collapsed ? (
          <CaretDoubleRight size={16} weight="bold" />
        ) : (
          <CaretDoubleLeft size={16} weight="bold" />
        )}
      </button>

      {items
        .filter((it) => it.visible !== false)
        .map((it) => {
          const isActive =
            pathname === it.href || pathname.startsWith(it.href + '/')
          if (it.disabled) {
            return (
              <span
                key={it.href}
                className={`flex cursor-not-allowed items-center gap-2 rounded-md ${itemPadX} py-2 text-sm text-ash/60`}
                aria-disabled
                title={collapsed ? it.label : `${it.label} — coming soon`}
              >
                <span className="text-ash/60">{it.icon}</span>
                {collapsed ? null : <span className="truncate">{it.label}</span>}
              </span>
            )
          }
          return (
            <Link
              key={it.href}
              href={it.href}
              className={`flex items-center gap-2 rounded-md ${itemPadX} py-2 text-sm transition-colors ${
                isActive
                  ? 'bg-cloud font-medium text-ink'
                  : 'text-ink/80 hover:bg-cloud'
              }`}
              title={collapsed ? it.label : undefined}
              aria-label={collapsed ? it.label : undefined}
            >
              <span className={isActive ? 'text-rausch' : 'text-ash'}>
                {it.icon}
              </span>
              {collapsed ? null : <span className="truncate">{it.label}</span>}
            </Link>
          )
        })}
    </nav>
  )
}
