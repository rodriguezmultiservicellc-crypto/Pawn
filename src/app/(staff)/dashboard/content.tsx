'use client'

import Link from 'next/link'
import {
  Users,
  Package,
  Prohibit,
  Lock,
  ArrowRight,
  Coins,
  Calendar,
  Wrench,
  CheckCircle,
  CashRegister,
  ShoppingBag,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import type { InventoryStatus } from '@/types/database-aliases'

export type RecentCustomer = {
  id: string
  first_name: string
  last_name: string
  phone: string | null
  created_at: string
}

export type RecentItem = {
  id: string
  sku: string
  description: string
  status: InventoryStatus
  list_price: number | string | null
  created_at: string
}

export default function DashboardContent({
  customerCount,
  bannedCount,
  inventoryCount,
  heldCount,
  recentCustomers,
  recentItems,
  hasPawn = false,
  activeLoanCount = 0,
  dueThisWeekCount = 0,
  hasRepair = false,
  activeRepairCount = 0,
  readyForPickupCount = 0,
  hasRetail = false,
  todaySalesCount = 0,
  todayRevenue = 0,
  activeLayawayCount = 0,
}: {
  customerCount: number
  bannedCount: number
  inventoryCount: number
  heldCount: number
  recentCustomers: RecentCustomer[]
  recentItems: RecentItem[]
  hasPawn?: boolean
  activeLoanCount?: number
  dueThisWeekCount?: number
  hasRepair?: boolean
  activeRepairCount?: number
  readyForPickupCount?: number
  hasRetail?: boolean
  todaySalesCount?: number
  todayRevenue?: number
  activeLayawayCount?: number
}) {
  const { t } = useI18n()

  const showSales = hasRetail
  const showPawn = hasPawn
  const showOrders = hasRepair
  const anyQuickAction = showSales || showPawn || showOrders

  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl font-bold text-navy">
        {t.dashboard.title}
      </h1>

      {anyQuickAction ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {showSales ? (
            <QuickActionTile
              label={t.dashboard.quickActions.sales}
              sub={t.dashboard.quickActions.salesSub}
              href="/pos"
              icon={<ShoppingBag size={36} weight="duotone" />}
              accent="success"
            />
          ) : null}
          {showPawn ? (
            <QuickActionTile
              label={t.dashboard.quickActions.pawn}
              sub={t.dashboard.quickActions.pawnSub}
              href="/pawn"
              icon={<Coins size={36} weight="duotone" />}
              accent="gold"
            />
          ) : null}
          {showOrders ? (
            <QuickActionTile
              label={t.dashboard.quickActions.orders}
              sub={t.dashboard.quickActions.ordersSub}
              href="/repair"
              icon={<Wrench size={36} weight="duotone" />}
              accent="blue"
            />
          ) : null}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label={t.dashboard.customersCard}
          sub={t.dashboard.customersCardSub}
          value={customerCount}
          icon={<Users size={20} weight="regular" />}
          href="/customers"
        />
        <StatCard
          label={t.dashboard.bannedCard}
          sub={t.customers.bannedBadge}
          value={bannedCount}
          icon={<Prohibit size={20} weight="regular" />}
          href="/customers?banned=1"
          tone={bannedCount > 0 ? 'error' : 'neutral'}
        />
        <StatCard
          label={t.dashboard.inventoryCard}
          sub={t.dashboard.inventoryCardSub}
          value={inventoryCount}
          icon={<Package size={20} weight="regular" />}
          href="/inventory?status=available"
        />
        <StatCard
          label={t.dashboard.heldCard}
          sub={t.inventory.statusHeld}
          value={heldCount}
          icon={<Lock size={20} weight="regular" />}
          href="/inventory?status=held"
          tone={heldCount > 0 ? 'warning' : 'neutral'}
        />
      </div>

      {hasPawn ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label={t.pawn.dashboardCards.activeLoansCard}
            sub={t.pawn.dashboardCards.activeLoansCardSub}
            value={activeLoanCount}
            icon={<Coins size={20} weight="regular" />}
            href="/pawn?status=active"
            module="pawn"
          />
          <StatCard
            label={t.pawn.dashboardCards.dueThisWeekCard}
            sub={t.pawn.dashboardCards.dueThisWeekCardSub}
            value={dueThisWeekCount}
            icon={<Calendar size={20} weight="regular" />}
            href="/pawn?status=active&due=dueSoon7"
            tone={dueThisWeekCount > 0 ? 'warning' : 'neutral'}
            module="pawn"
          />
        </div>
      ) : null}

      {hasRepair ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label={t.repair.dashboardCards.activeRepairsCard}
            sub={t.repair.dashboardCards.activeRepairsCardSub}
            value={activeRepairCount}
            icon={<Wrench size={20} weight="regular" />}
            href="/repair?status=active"
            module="repair"
          />
          <StatCard
            label={t.repair.dashboardCards.readyForPickupCard}
            sub={t.repair.dashboardCards.readyForPickupCardSub}
            value={readyForPickupCount}
            icon={<CheckCircle size={20} weight="regular" />}
            href="/repair?status=ready"
            tone={readyForPickupCount > 0 ? 'warning' : 'neutral'}
            module="repair"
          />
        </div>
      ) : null}

      {hasRetail ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label={t.pos.dashboardCards.todaySalesCard}
            sub={t.pos.dashboardCards.todaySalesCardSub}
            value={todaySalesCount}
            icon={<CashRegister size={20} weight="regular" />}
            href="/pos"
            module="retail"
          />
          <RevenueCard
            label={t.pos.dashboardCards.todayRevenueCard}
            sub={t.pos.dashboardCards.todayRevenueCardSub}
            value={todayRevenue}
            icon={<CashRegister size={20} weight="regular" />}
            href="/pos"
          />
          <StatCard
            label={t.pos.dashboardCards.activeLayawaysCard}
            sub={t.pos.dashboardCards.activeLayawaysCardSub}
            value={activeLayawayCount}
            icon={<ShoppingBag size={20} weight="regular" />}
            href="/pos/layaways?status=active"
            module="retail"
          />
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel
          title={t.dashboard.recentCustomers}
          seeAllHref="/customers"
          seeAllLabel={t.dashboard.seeAll}
        >
          {recentCustomers.length === 0 ? (
            <Empty>{t.dashboard.none}</Empty>
          ) : (
            <ul className="divide-y divide-border">
              {recentCustomers.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/customers/${c.id}`}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-background"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium text-foreground">
                        {c.last_name}, {c.first_name}
                      </div>
                      <div className="truncate text-xs text-muted">
                        {c.phone ?? '—'}
                      </div>
                    </div>
                    <div className="shrink-0 text-xs text-muted">
                      {relativeDate(c.created_at)}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title={t.dashboard.recentInventory}
          seeAllHref="/inventory"
          seeAllLabel={t.dashboard.seeAll}
        >
          {recentItems.length === 0 ? (
            <Empty>{t.dashboard.none}</Empty>
          ) : (
            <ul className="divide-y divide-border">
              {recentItems.map((it) => (
                <li key={it.id}>
                  <Link
                    href={`/inventory/${it.id}`}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-background"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium text-foreground">
                        {it.description}
                      </div>
                      <div className="truncate font-mono text-xs text-muted">
                        {it.sku}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-xs text-muted">
                        {relativeDate(it.created_at)}
                      </div>
                      {it.list_price != null ? (
                        <div className="font-mono text-xs text-foreground">
                          {formatMoney(it.list_price)}
                        </div>
                      ) : null}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  )
}

type StatTone = 'neutral' | 'warning' | 'error'
type ModuleAccent = 'pawn' | 'repair' | 'retail'
type QuickActionAccent = 'gold' | 'blue' | 'success'

function QuickActionTile({
  label,
  sub,
  href,
  icon,
  accent,
}: {
  label: string
  sub: string
  href: string
  icon: React.ReactNode
  accent: QuickActionAccent
}) {
  const palette: Record<QuickActionAccent, string> = {
    gold: 'border-gold/30 bg-gold/10 text-gold hover:bg-gold/15',
    blue: 'border-blue/30 bg-blue/10 text-blue hover:bg-blue/15',
    success: 'border-success/30 bg-success/10 text-success hover:bg-success/15',
  }
  return (
    <Link
      href={href}
      className={`flex items-center gap-4 rounded-xl border p-6 transition-all hover:-translate-y-1 hover:shadow-lg ${palette[accent]}`}
    >
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-white/60">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="font-display text-2xl font-bold uppercase tracking-wide">
          {label}
        </div>
        <div className="text-sm font-medium opacity-80">{sub}</div>
      </div>
    </Link>
  )
}

function StatCard({
  label,
  sub,
  value,
  icon,
  href,
  tone = 'neutral',
  module,
}: {
  label: string
  sub: string
  value: number
  icon: React.ReactNode
  href: string
  tone?: StatTone
  /** When set, overrides the neutral icon-chip tint to a per-module
   *  identity color so the pawn / repair / retail rows visually
   *  cluster on the dashboard. tone='warning' / 'error' still wins
   *  (a due-soon loan should look amber regardless of module). */
  module?: ModuleAccent
}) {
  const accent =
    tone === 'error'
      ? 'border-danger/40 bg-danger/5'
      : tone === 'warning'
      ? 'border-warning/40 bg-warning/5'
      : 'border-border bg-card'
  const valueColor =
    tone === 'error' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-foreground'
  const moduleChip: Record<ModuleAccent, string> = {
    pawn: 'bg-gold/10 text-gold',
    repair: 'bg-blue/10 text-blue',
    retail: 'bg-success/10 text-success',
  }
  const iconChip =
    tone === 'error'
      ? 'bg-danger/10 text-danger'
      : tone === 'warning'
      ? 'bg-warning/10 text-warning'
      : module
      ? moduleChip[module]
      : 'bg-navy/5 text-navy'

  return (
    <Link
      href={href}
      className={`flex flex-col gap-2 rounded-xl border p-5 transition-all hover:-translate-y-1 hover:shadow-lg ${accent}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">
          {label}
        </span>
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${iconChip}`}>
          {icon}
        </span>
      </div>
      <div className={`font-mono text-3xl font-bold ${valueColor}`}>
        {value}
      </div>
      <div className="text-xs text-muted">{sub}</div>
    </Link>
  )
}

function RevenueCard({
  label,
  sub,
  value,
  icon,
  href,
}: {
  label: string
  sub: string
  value: number
  icon: React.ReactNode
  href: string
}) {
  const formatted = value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  })
  return (
    <Link
      href={href}
      className="flex flex-col gap-2 rounded-xl border border-border bg-card p-5 transition-all hover:-translate-y-1 hover:shadow-lg"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">
          {label}
        </span>
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-success/10 text-success">
          {icon}
        </span>
      </div>
      <div className="font-mono text-2xl font-bold text-foreground">
        {formatted}
      </div>
      <div className="text-xs text-muted">{sub}</div>
    </Link>
  )
}

function Panel({
  title,
  seeAllHref,
  seeAllLabel,
  children,
}: {
  title: string
  seeAllHref: string
  seeAllLabel: string
  children: React.ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card transition-all hover:shadow-lg">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        <Link
          href={seeAllHref}
          className="inline-flex items-center gap-1 text-xs font-semibold text-muted transition-colors hover:text-blue"
        >
          {seeAllLabel}
          <ArrowRight size={10} weight="bold" />
        </Link>
      </header>
      {children}
    </section>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-6 text-center text-sm text-muted">{children}</div>
}

function relativeDate(iso: string): string {
  const t = new Date(iso).getTime()
  if (!isFinite(t)) return ''
  const seconds = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d`
  return new Date(iso).toLocaleDateString()
}

function formatMoney(v: number | string): string {
  const n = typeof v === 'string' ? parseFloat(v) : v
  if (!isFinite(n)) return '—'
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  })
}
