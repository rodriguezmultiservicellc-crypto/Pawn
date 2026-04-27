'use client'

import Link from 'next/link'
import {
  Users,
  Package,
  Prohibit,
  Lock,
  ArrowRight,
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
}: {
  customerCount: number
  bannedCount: number
  inventoryCount: number
  heldCount: number
  recentCustomers: RecentCustomer[]
  recentItems: RecentItem[]
}) {
  const { t } = useI18n()

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t.dashboard.title}</h1>

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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel
          title={t.dashboard.recentCustomers}
          seeAllHref="/customers"
          seeAllLabel={t.dashboard.seeAll}
        >
          {recentCustomers.length === 0 ? (
            <Empty>{t.dashboard.none}</Empty>
          ) : (
            <ul className="divide-y divide-hairline">
              {recentCustomers.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/customers/${c.id}`}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-cloud"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium text-ink">
                        {c.last_name}, {c.first_name}
                      </div>
                      <div className="truncate text-xs text-ash">
                        {c.phone ?? '—'}
                      </div>
                    </div>
                    <div className="shrink-0 text-xs text-ash">
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
            <ul className="divide-y divide-hairline">
              {recentItems.map((it) => (
                <li key={it.id}>
                  <Link
                    href={`/inventory/${it.id}`}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-cloud"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium text-ink">
                        {it.description}
                      </div>
                      <div className="truncate font-mono text-xs text-ash">
                        {it.sku}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-xs text-ash">
                        {relativeDate(it.created_at)}
                      </div>
                      {it.list_price != null ? (
                        <div className="font-mono text-xs text-ink">
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

function StatCard({
  label,
  sub,
  value,
  icon,
  href,
  tone = 'neutral',
}: {
  label: string
  sub: string
  value: number
  icon: React.ReactNode
  href: string
  tone?: 'neutral' | 'warning' | 'error'
}) {
  const accent =
    tone === 'error'
      ? 'border-error/40 bg-error/5'
      : tone === 'warning'
      ? 'border-warning/40 bg-warning/5'
      : 'border-hairline bg-canvas'
  const valueColor =
    tone === 'error' ? 'text-error' : tone === 'warning' ? 'text-warning' : 'text-ink'

  return (
    <Link
      href={href}
      className={`flex flex-col gap-1 rounded-lg border p-4 transition-colors hover:border-ink ${accent}`}
    >
      <div className="flex items-center justify-between text-ash">
        <span className="text-xs uppercase tracking-wide">{label}</span>
        {icon}
      </div>
      <div className={`font-mono text-3xl font-semibold ${valueColor}`}>
        {value}
      </div>
      <div className="text-xs text-ash">{sub}</div>
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
    <section className="overflow-hidden rounded-lg border border-hairline bg-canvas">
      <header className="flex items-center justify-between border-b border-hairline px-3 py-2">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        <Link
          href={seeAllHref}
          className="inline-flex items-center gap-1 text-xs text-ash hover:text-ink"
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
  return <div className="px-3 py-6 text-center text-sm text-ash">{children}</div>
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
