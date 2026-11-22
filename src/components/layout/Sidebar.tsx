'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
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
  Certificate,
  CaretDoubleLeft,
  CaretDoubleRight,
  CaretDown,
  Storefront,
  CreditCard,
  Calculator,
  CurrencyDollar,
  HandCoins,
  Receipt,
  Trophy,
  Wallet,
  ListChecks,
  Globe,
  Plus,
  UploadSimple,
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
 *
 * Group open / close:
 *   - Inventory, POS, Pawns and Repair each fold their sub-items away. The
 *     caret on the group row toggles it; Inventory and POS stay links, the
 *     Pawns and Repair headings toggle on a click anywhere in the row.
 *   - Closed groups persist in localStorage under
 *     `pawn.sidebar.groups.closed`. All groups start open.
 *   - A closed group that holds the current page lights its own row, so
 *     the user still sees where they are.
 *   - The icon rail (collapsed sidebar) ignores this and shows every icon:
 *     it has no heading row to reopen a group from.
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

type GroupId = 'inventory' | 'pos' | 'pawns' | 'repair'

const GROUPS_KEY = 'pawn.sidebar.groups.closed'
const GROUPS_EVENT = 'pawn:sidebar-groups'

// The closed groups as one comma-joined string: a primitive snapshot, so
// useSyncExternalStore compares it by value. The server snapshot is ''
// (all open), which keeps hydration identical to the server HTML; React
// switches to the stored value right after.
function readClosedGroups(): string {
  try {
    return localStorage.getItem(GROUPS_KEY) ?? ''
  } catch {
    return ''
  }
}

function serverClosedGroups(): string {
  return ''
}

function subscribeClosedGroups(onChange: () => void): () => void {
  window.addEventListener('storage', onChange)
  window.addEventListener(GROUPS_EVENT, onChange)
  return () => {
    window.removeEventListener('storage', onChange)
    window.removeEventListener(GROUPS_EVENT, onChange)
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

  const closedGroups = new Set(
    useSyncExternalStore(
      subscribeClosedGroups,
      readClosedGroups,
      serverClosedGroups,
    )
      .split(',')
      .filter(Boolean),
  )

  const toggleGroup = (group: GroupId) => {
    const next = new Set(closedGroups)
    if (next.has(group)) next.delete(group)
    else next.add(group)
    try {
      localStorage.setItem(GROUPS_KEY, [...next].join(','))
    } catch {}
    window.dispatchEvent(new Event(GROUPS_EVENT))
  }

  const canSeeAudit = !!tenantRole && AUDIT_ROLES.has(tenantRole)
  const canSeeCollections = !!tenantRole && COLLECTIONS_ROLES.has(tenantRole)
  const canSeeSettings = !!tenantRole && SETTINGS_ROLES.has(tenantRole)
  const canSeeBilling = !!tenantRole && BILLING_ROLES.has(tenantRole)
  const canSeeLoyalty = !!tenantRole && LOYALTY_ROLES.has(tenantRole)
  const canSeeCounts = !!tenantRole && COUNT_ROLES.has(tenantRole)
  // Same roles as lib/imports/access resolveImportRole.
  const canSeeImport = !!tenantRole && AUDIT_ROLES.has(tenantRole)
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
    /** Sub-item of the entry above it: indented, 16px icon. */
    child?: boolean
    /** Group label over its children: not a link, never active, hidden
     *  when the sidebar is collapsed (the children's icons remain). */
    heading?: boolean
    /** The open / close group this row belongs to. The row without
     *  `child` is the group's own row and carries the caret. */
    group?: GroupId
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
    { kind: 'item', href: '/inventory', label: t.nav.inventory, icon: <Package size={18} weight="regular" />, group: 'inventory' },
    // Inventory's own actions, indented under it.
    {
      kind: 'item',
      href: '/inventory/new',
      group: 'inventory',
      label: t.nav.newItem,
      icon: <Plus size={16} weight="regular" />,
      child: true,
    },
    {
      kind: 'item',
      href: '/inventory/import',
      group: 'inventory',
      label: t.nav.importInventory,
      icon: <UploadSimple size={16} weight="regular" />,
      visible: canSeeImport,
      child: true,
    },
    {
      kind: 'item',
      href: '/inventory/counts',
      group: 'inventory',
      label: t.nav.counts,
      icon: <ListChecks size={16} weight="regular" />,
      visible: canSeeCounts,
      child: true,
    },
    // Consigned goods ARE inventory, the shop just doesn't own them.
    {
      kind: 'item',
      href: '/consignors',
      group: 'inventory',
      label: t.nav.consignors,
      icon: <HandCoins size={16} weight="regular" />,
      visible: consignmentEnabled,
      child: true,
    },
    {
      kind: 'item',
      href: '/inventory/transfers',
      group: 'inventory',
      label: t.nav.transfers,
      icon: <ArrowsLeftRight size={16} weight="regular" />,
      visible: canSeeTransfers,
      child: true,
    },

    // Modules — gated per tenant.has_pawn / has_repair / has_retail.
    { kind: 'section' },
    // POS hub (register, returns) with its three everyday pages under it.
    // The longest matching root wins, so /pos/sales/123 lights Sale
    // history and /pos/returns lights POS.
    {
      kind: 'item',
      href: '/pos',
      group: 'pos',
      label: t.nav.pos,
      icon: <CashRegister size={18} weight="regular" />,
      visible: modules.has_retail,
    },
    {
      kind: 'item',
      href: '/pos/sales/new',
      group: 'pos',
      label: t.nav.newSale,
      icon: <Plus size={16} weight="regular" />,
      visible: modules.has_retail,
      child: true,
    },
    {
      kind: 'item',
      href: '/pos/layaways',
      group: 'pos',
      label: t.nav.layawayList,
      icon: <Wallet size={16} weight="regular" />,
      visible: modules.has_retail,
      child: true,
    },
    {
      kind: 'item',
      href: '/pos/sales',
      group: 'pos',
      label: t.nav.saleHistory,
      icon: <Receipt size={16} weight="regular" />,
      visible: modules.has_retail,
      child: true,
    },
    // Orders paid on the shop's website (patches/0078). A more specific
    // root than /pos, so it — not POS — lights up on its own pages.
    {
      kind: 'item',
      href: '/pos/online-orders',
      group: 'pos',
      label: t.nav.onlineOrders,
      icon: <Globe size={16} weight="regular" />,
      visible: modules.has_retail && canSeeCounts,
      child: true,
    },
    // Pawns — a heading (not a link) over the pawn counter's four pages.
    {
      kind: 'item',
      href: '#pawns',
      group: 'pawns',
      label: t.nav.pawns,
      icon: <Coins size={18} weight="regular" />,
      visible: modules.has_pawn,
      heading: true,
    },
    {
      kind: 'item',
      href: '/pawn/new',
      group: 'pawns',
      label: t.nav.newPawn,
      icon: <Plus size={16} weight="regular" />,
      visible: modules.has_pawn,
      child: true,
    },
    {
      kind: 'item',
      href: '/pawn',
      group: 'pawns',
      label: t.nav.pawns,
      icon: <Coins size={16} weight="regular" />,
      visible: modules.has_pawn,
      child: true,
    },
    {
      kind: 'item',
      href: '/buy/new',
      group: 'pawns',
      // Buy-outright detail pages live at /buy/<id>.
      activePrefix: '/buy',
      label: t.nav.buyOutright,
      icon: <HandCoins size={16} weight="regular" />,
      visible: modules.has_pawn,
      child: true,
    },
    {
      kind: 'item',
      href: '/pawn/calculator',
      group: 'pawns',
      label: t.nav.loanCalculator,
      icon: <Calculator size={16} weight="regular" />,
      visible: modules.has_pawn,
      child: true,
    },
    // Repair — a heading over the bench's three pages.
    {
      kind: 'item',
      href: '#repair',
      group: 'repair',
      label: t.nav.repair,
      icon: <Wrench size={18} weight="regular" />,
      visible: modules.has_repair,
      heading: true,
    },
    {
      kind: 'item',
      href: '/repair/new',
      group: 'repair',
      label: t.nav.newRepair,
      icon: <Plus size={16} weight="regular" />,
      visible: modules.has_repair,
      child: true,
    },
    {
      kind: 'item',
      href: '/repair',
      group: 'repair',
      label: t.nav.repairs,
      icon: <Wrench size={16} weight="regular" />,
      visible: modules.has_repair,
      child: true,
    },
    {
      kind: 'item',
      href: '/repair/quotes',
      group: 'repair',
      label: t.nav.quotes,
      icon: <Sparkle size={16} weight="regular" />,
      visible: modules.has_repair,
      child: true,
    },

    // Reporting + records. Sell metal, Spot prices and eBay listings lead
    // this group (Eddy, 2026-11-21).
    { kind: 'section' },
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
      href: '/inventory/spot-prices',
      label: t.nav.spotPrices,
      icon: <Scales size={18} weight="regular" />,
      visible: canSeeSettings || modules.has_pawn || modules.has_retail,
    },
    {
      kind: 'item',
      href: '/inventory/listings/ebay',
      label: t.nav.ebayListings,
      icon: <Storefront size={18} weight="regular" />,
      visible: modules.has_retail,
    },
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
    if (it.kind !== 'item' || it.visible === false || it.heading) return best
    const root = it.activePrefix ?? it.href
    const hit = pathname === root || pathname.startsWith(root + '/')
    return hit && (!best || root.length > best.length) ? root : best
  }, null)

  const visibleItems = items.filter(
    (it): it is NavItem => it.kind === 'item' && it.visible !== false,
  )
  // The group holding the current page: its row lights up while closed.
  const activeGroup =
    visibleItems.find(
      (it) => !it.heading && (it.activePrefix ?? it.href) === bestActiveRoot,
    )?.group ?? null
  // Only a group with something under it gets a caret.
  const groupsWithChildren = new Set(
    visibleItems.filter((it) => it.child && it.group).map((it) => it.group),
  )
  // The icon rail shows every icon, so nothing counts as closed there.
  const isClosed = (group?: GroupId) =>
    !collapsed && !!group && closedGroups.has(group)

  const widthClass = collapsed ? 'w-16' : 'w-52'
  const itemPadX = collapsed ? 'px-0 justify-center' : 'px-3'
  const rowTone = (lit: boolean) =>
    lit ? 'bg-white/10 text-gold' : 'text-white/65 hover:bg-white/5 hover:text-white'
  const groupCaret = (open: boolean) => (
    <CaretDown
      size={14}
      weight="bold"
      className={`shrink-0 transition-transform ${open ? '' : '-rotate-90'}`}
    />
  )

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
        .filter(
          (it) =>
            it.kind === 'section' ||
            (it.visible !== false && !(it.child && isClosed(it.group))),
        )
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
          if (it.heading) {
            if (collapsed) return null
            const group = it.group
            const open = !isClosed(group)
            const lit = !open && activeGroup === group
            return (
              <button
                key={it.href}
                type="button"
                onClick={() => group && toggleGroup(group)}
                aria-expanded={open}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 ${rowTone(lit)}`}
              >
                <span className={lit ? 'text-gold' : 'text-white/65'}>
                  {it.icon}
                </span>
                <span className="min-w-0 flex-1 truncate">{it.label}</span>
                {groupCaret(open)}
              </button>
            )
          }
          const activeRoot = it.activePrefix ?? it.href
          // A group's own row (Inventory, POS) carries the caret.
          const caretGroup =
            !collapsed && !it.child && it.group && groupsWithChildren.has(it.group)
              ? it.group
              : null
          const groupOpen = !isClosed(it.group)
          // Only the most specific match lights up: /inventory/counts is
          // Counts, not Inventory as well — unless Inventory is closed and
          // Counts is hidden, then Inventory stands in for it.
          const isActive =
            activeRoot === bestActiveRoot ||
            (!!caretGroup && !groupOpen && activeGroup === caretGroup)
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
          if (caretGroup) {
            const caretLabel = (
              groupOpen ? t.common.collapseGroup : t.common.expandGroup
            ).replace('{group}', it.label)
            return (
              <div
                key={it.href}
                className={`flex items-center rounded-lg text-sm font-medium transition-colors ${rowTone(isActive)}`}
              >
                <Link
                  href={it.href}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-lg py-2 pl-3"
                >
                  <span className={isActive ? 'text-gold' : 'text-white/65'}>
                    {it.icon}
                  </span>
                  <span className="truncate">{it.label}</span>
                </Link>
                <button
                  type="button"
                  onClick={() => toggleGroup(caretGroup)}
                  aria-expanded={groupOpen}
                  aria-label={caretLabel}
                  title={caretLabel}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/50"
                >
                  {groupCaret(groupOpen)}
                </button>
              </div>
            )
          }
          return (
            <Link
              key={it.href}
              href={it.href}
              className={`flex items-center gap-2 rounded-lg ${it.child && !collapsed ? 'pl-8 pr-3 py-1.5' : `${itemPadX} py-2`} text-sm font-medium transition-colors ${rowTone(isActive)}`}
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
