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
  Sparkle,
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
  Calculator,
  CurrencyDollar,
  HandCoins,
  Receipt,
  Trophy,
  Wallet,
  ListChecks,
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
// Collections (brief Phase 4.3): whoever can take a payment can see who owes.
const COLLECTIONS_ROLES = new Set<TenantRole>(['owner', 'manager', 'chain_admin', 'pawn_clerk'])
// Stock counts and vault audits (patches/0075).
const COUNT_ROLES = new Set<TenantRole>(['owner', 'manager', 'chain_admin', 'pawn_clerk'])
const SETTINGS_ROLES = new Set<TenantRole>(['owner', 'manager', 'chain_admin'])
const BILLING_ROLES = new Set<TenantRole>(['owner', 'chain_admin'])
const LOYALTY_ROLES = new Set<TenantRole>(['owner', 'chain_admin'])

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
  consignmentEnabled = false,
}: {
  modules: Modules
  tenantRole: TenantRole | null
  tenant?: Tenant
  /** settings.consignment_enabled — hides the Consignors entry when off. */
  consignmentEnabled?: boolean
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
  const canSeeCollections = !!tenantRole && COLLECTIONS_ROLES.has(tenantRole)
  const canSeeSettings = !!tenantRole && SETTINGS_ROLES.has(tenantRole)
  const canSeeBilling = !!tenantRole && BILLING_ROLES.has(tenantRole)
  const canSeeLoyalty = !!tenantRole && LOYALTY_ROLES.has(tenantRole)
  const canSeeCounts = !!tenantRole && COUNT_ROLES.has(tenantRole)
  const canSeeTransfers =
    tenant?.tenant_type === 'shop' && !!tenant.parent_tenant_id

  type NavItem = {
    kind: 'item'
    href: string
    label: string
    icon: React.ReactNode
    disabled?: boolean
    visible?: boolean
    /** Highlight for every path under this prefix, when href is a deep link. */
    activePrefix?: string
  }
  type NavSection = {
    /** Visual divider between groups. Renders as a hairline (collapsed)
     *  or a hairline + uppercase muted label (expanded). */
    kind: 'section'
  }

  const items: Array<NavItem | NavSection> = [
    // Operations — top-level day-to-day navigation, no section label.
    { kind: 'item', href: '/dashboard', label: t.nav.dashboard, icon: <House size={18} weight="regular" /> },
    { kind: 'item', href: '/customers', label: t.nav.customers, icon: <Users size={18} weight="regular" /> },
    { kind: 'item', href: '/inventory', label: t.nav.inventory, icon: <Package size={18} weight="regular" /> },
    {
      kind: 'item',
      href: '/inventory/transfers',
      label: t.nav.transfers,
      icon: <ArrowsLeftRight size={18} weight="regular" />,
      visible: canSeeTransfers,
    },
    {
      kind: 'item',
      href: '/inventory/counts',
      label: t.nav.counts,
      icon: <ListChecks size={18} weight="regular" />,
      visible: canSeeCounts,
    },
    // eBay listings — under Inventory because the listings ARE inventory
    // items being published. Settings/integrations entry is owner-only and
    // users will navigate there from the per-listing UI.
    {
      kind: 'item',
      href: '/inventory/listings/ebay',
      label: t.nav.ebayListings,
      icon: <Storefront size={18} weight="regular" />,
      visible: modules.has_retail,
    },
    // Consignors sit under Inventory: consigned goods ARE inventory, the
    // shop just doesn't own them.
    {
      kind: 'item',
      href: '/consignors',
      label: t.nav.consignors,
      icon: <HandCoins size={18} weight="regular" />,
      visible: consignmentEnabled,
    },
    {
      kind: 'item',
      href: '/inventory/spot-prices',
      label: t.nav.spotPrices,
      icon: <Scales size={18} weight="regular" />,
      visible: canSeeSettings || modules.has_pawn || modules.has_retail,
    },

    // Modules — gated per tenant.has_pawn / has_repair / has_retail.
    { kind: 'section' },
    // POS first, straight into a new sale — the most-used counter action.
    // The new-sale page links back to the /pos hub (layaways, returns,
    // register), and the item stays highlighted anywhere under /pos.
    {
      kind: 'item',
      href: '/pos/sales/new',
      activePrefix: '/pos',
      label: t.nav.pos,
      icon: <CashRegister size={18} weight="regular" />,
      visible: modules.has_retail,
    },
    {
      kind: 'item',
      href: '/pawn',
      label: t.nav.pawn,
      icon: <Coins size={18} weight="regular" />,
      visible: modules.has_pawn,
    },
    {
      kind: 'item',
      href: '/pawn/calculator',
      label: t.nav.loanCalculator,
      icon: <Calculator size={18} weight="regular" />,
      visible: modules.has_pawn,
    },
    {
      kind: 'item',
      href: '/buy/new',
      label: t.nav.buyOutright,
      icon: <HandCoins size={18} weight="regular" />,
      visible: modules.has_pawn,
    },
    // Sell metal (brief Phase 3) — scrap / bullion out the door. Rung up
    // as a sale, so a retail-only shop gets it too.
    {
      kind: 'item',
      href: '/buy/sell',
      label: t.nav.sellMetal,
      icon: <Coins size={18} weight="regular" />,
      visible: modules.has_pawn || modules.has_retail,
    },
    {
      kind: 'item',
      href: '/repair',
      label: t.nav.repair,
      icon: <Wrench size={18} weight="regular" />,
      visible: modules.has_repair,
    },
    {
      kind: 'item',
      href: '/repair/quotes',
      label: t.nav.quotes,
      icon: <Sparkle size={18} weight="regular" />,
      visible: modules.has_repair,
    },

    // Reporting + records.
    { kind: 'section' },
    {
      kind: 'item',
      href: '/appraisals',
      label: t.nav.appraisals,
      icon: <Certificate size={18} weight="regular" />,
    },
    // Bench calculators (brief Phase 4.1) — any staff role.
    {
      kind: 'item',
      href: '/tools',
      label: t.nav.tools,
      icon: <Calculator size={18} weight="regular" />,
    },
    { kind: 'item', href: '/reports', label: t.nav.reports, icon: <ChartBar size={18} weight="regular" /> },
    // Collections (brief Phase 4.3) — everyone who owes money, all sources.
    {
      kind: 'item',
      href: '/collections',
      label: t.nav.collections,
      icon: <CurrencyDollar size={18} weight="regular" />,
      visible: canSeeCollections,
    },
    {
      kind: 'item',
      href: '/reports/police-report',
      label: t.nav.compliance,
      icon: <Shield size={18} weight="regular" />,
    },
    {
      kind: 'item',
      href: '/reports/1099',
      label: t.nav.form1099,
      icon: <Receipt size={18} weight="regular" />,
      // Owner / manager / chain_admin only — pawn_clerks and repair_techs
      // shouldn't see year-end totals. Same membership as audit log.
      visible: canSeeAudit,
    },
    {
      kind: 'item',
      href: '/audit',
      label: t.nav.audit,
      icon: <ClockCounterClockwise size={18} weight="regular" />,
      visible: canSeeAudit,
    },

    // Admin.
    { kind: 'section' },
    {
      kind: 'item',
      href: '/team',
      label: t.nav.team,
      icon: <UsersThree size={18} weight="regular" />,
      visible: canSeeAudit, // owner / chain_admin / manager
    },
    {
      kind: 'item',
      href: '/settings/communications',
      label: t.nav.communications,
      icon: <ChatCircleText size={18} weight="regular" />,
      visible: canSeeSettings,
    },
    {
      kind: 'item',
      href: '/settings/loyalty',
      label: t.nav.loyalty,
      icon: <Trophy size={18} weight="regular" />,
      visible: canSeeLoyalty,
    },
    {
      kind: 'item',
      href: '/settings/store-credit',
      label: t.nav.storeCredit,
      icon: <Wallet size={18} weight="regular" />,
      visible: canSeeLoyalty,
    },
    {
      kind: 'item',
      href: '/billing',
      label: t.nav.billing,
      icon: <CreditCard size={18} weight="regular" />,
      visible: canSeeBilling,
    },
    {
      kind: 'item',
      href: '/settings',
      label: t.nav.settings,
      icon: <Gear size={18} weight="regular" />,
      visible: canSeeSettings,
    },
  ]

  // The longest visible root that contains the current path.
  const bestActiveRoot = items.reduce<string | null>((best, it) => {
    if (it.kind !== 'item' || it.visible === false) return best
    const root = it.activePrefix ?? it.href
    const hit = pathname === root || pathname.startsWith(root + '/')
    return hit && (!best || root.length > best.length) ? root : best
  }, null)

  const widthClass = collapsed ? 'w-16' : 'w-52'
  const itemPadX = collapsed ? 'px-0 justify-center' : 'px-3'

  return (
    <nav
      className={`flex ${widthClass} shrink-0 flex-col gap-0.5 bg-navy px-2 py-4 transition-[width] duration-150`}
      aria-label="Primary"
    >
      <button
        type="button"
        onClick={toggle}
        className="mb-2 flex h-8 items-center justify-center rounded-md text-white/65 hover:bg-white/5 hover:text-white focus:outline-none focus:ring-2 focus:ring-gold/50"
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
        .filter((it) => it.kind === 'section' || it.visible !== false)
        // Drop a section divider whose group is empty (all items filtered
        // out by visibility) or that lands at the end of the list. Two
        // passes:
        //   - reduce: never push a section if the previous accepted entry
        //     is also a section (collapses adjacent dividers from a
        //     fully-hidden group).
        //   - then drop a trailing section if the list ends with one.
        .reduce<Array<NavItem | NavSection>>((acc, it) => {
          if (it.kind === 'section') {
            const last = acc[acc.length - 1]
            if (!last || last.kind === 'section') return acc
          }
          acc.push(it)
          return acc
        }, [])
        .filter((it, idx, arr) => !(it.kind === 'section' && idx === arr.length - 1))
        .map((it, idx) => {
          if (it.kind === 'section') {
            return (
              <div
                key={`sep-${idx}`}
                role="separator"
                className="my-2 border-t border-white/10"
              />
            )
          }
          const activeRoot = it.activePrefix ?? it.href
          // Only the most specific match lights up: /inventory/counts is
          // Counts, not Inventory as well.
          const isActive = activeRoot === bestActiveRoot
          if (it.disabled) {
            return (
              <span
                key={it.href}
                className={`flex cursor-not-allowed items-center gap-2 rounded-lg ${itemPadX} py-2 text-sm text-white/40`}
                aria-disabled
                title={collapsed ? it.label : `${it.label} — coming soon`}
              >
                <span className="text-white/40">{it.icon}</span>
                {collapsed ? null : <span className="truncate">{it.label}</span>}
              </span>
            )
          }
          return (
            <Link
              key={it.href}
              href={it.href}
              className={`flex items-center gap-2 rounded-lg ${itemPadX} py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-white/10 text-gold'
                  : 'text-white/65 hover:bg-white/5 hover:text-white'
              }`}
              title={collapsed ? it.label : undefined}
              aria-label={collapsed ? it.label : undefined}
            >
              <span className={isActive ? 'text-gold' : 'text-white/65'}>
                {it.icon}
              </span>
              {collapsed ? null : <span className="truncate">{it.label}</span>}
            </Link>
          )
        })}
    </nav>
  )
}
