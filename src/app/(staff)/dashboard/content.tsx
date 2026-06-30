'use client'

import Link from 'next/link'
import {
  Users,
  Package,
  Prohibit,
  Lock,
  CaretRight,
  Coins,
  Calendar,
  Clock,
  Wrench,
  CheckCircle,
  HandCoins,
  ShoppingBag,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'

export type DueSoonRow = {
  id: string
  ticket_number: string
  customer_name: string
  due_date: string
  days: number
  payoff: number
}

export type ActivityRow = {
  id: string
  kind: 'sale' | 'loan' | 'pay' | 'redeem'
  title: string
  subtitle: string | null
  amount: number | null
  occurredAt: string
  href: string
  eventType?: string
}

type Money = {
  todaySalesCount: number
  todayRevenue: number
  onLoanNow: number
  interestDue7: number
  dueThisWeekCount: number
  overdueAtRisk: number
  overdueLoanCount: number
}

type Attention = {
  dueThisWeekCount: number
  overdueLoanCount: number
  heldCount: number
  readyForPickupCount: number
  repairsNeedPartsCount: number
}

type Library = {
  customerCount: number
  inventoryCount: number
  bannedCount: number
}

export default function DashboardContent({
  hasPawn,
  hasRepair,
  hasRetail,
  today,
  money,
  attention,
  loansDueSoon,
  activity,
  library,
  activeLoanCount,
}: {
  hasPawn: boolean
  hasRepair: boolean
  hasRetail: boolean
  today: string
  money: Money
  attention: Attention
  loansDueSoon: DueSoonRow[]
  activity: ActivityRow[]
  library: Library
  activeLoanCount: number
}) {
  const { t } = useI18n()
  const d = t.dashboard

  const anyQuickAction = hasRetail || hasPawn || hasRepair

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-baseline justify-between">
        <h1 className="font-display text-2xl font-bold text-navy">{d.title}</h1>
        <span className="text-sm font-semibold text-muted">
          {formatDateLong(today)}
        </span>
      </div>

      {/* Quick actions */}
      {anyQuickAction ? (
        <div className="grid grid-cols-1 gap-3.5 pt-4 sm:grid-cols-3">
          {hasRetail ? (
            <QuickAction
              accent="success"
              icon={<ShoppingBag size={22} weight="regular" />}
              title={d.qaNewSale}
              sub={d.qaNewSaleSub}
              href="/pos/sales/new"
            />
          ) : null}
          {hasPawn ? (
            <QuickAction
              accent="gold"
              icon={<Coins size={22} weight="regular" />}
              title={d.qaNewLoan}
              sub={d.qaNewLoanSub}
              href="/pawn/new"
            />
          ) : null}
          {hasRepair ? (
            <QuickAction
              accent="blue"
              icon={<Wrench size={22} weight="regular" />}
              title={d.qaNewRepair}
              sub={d.qaNewRepairSub}
              href="/repair/new"
            />
          ) : null}
        </div>
      ) : null}

      {/* Money KPIs */}
      <SectionLabel>{d.sectionMoney}</SectionLabel>
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        {hasRetail ? (
          <Kpi
            accent="bg-success"
            label={d.kpiTodaySales}
            value={fmtMoney(money.todayRevenue)}
            sub={d.kpiTodaySalesSub.replace('{n}', String(money.todaySalesCount))}
          />
        ) : null}
        {hasPawn ? (
          <>
            <Kpi
              accent="bg-navy"
              label={d.kpiOnLoan}
              value={fmtMoney(money.onLoanNow)}
              sub={d.kpiOnLoanSub.replace('{n}', String(activeLoanCount))}
            />
            <Kpi
              accent="bg-warning"
              label={d.kpiInterestDue}
              value={fmtMoney(money.interestDue7)}
              sub={d.kpiInterestDueSub.replace(
                '{n}',
                String(money.dueThisWeekCount),
              )}
            />
            <Kpi
              accent="bg-danger"
              label={d.kpiOverdue}
              value={fmtMoney(money.overdueAtRisk)}
              valueClass="text-danger"
              sub={d.kpiOverdueSub.replace('{n}', String(money.overdueLoanCount))}
            />
          </>
        ) : null}
      </div>

      {/* Needs attention */}
      <SectionLabel>{d.sectionAttention}</SectionLabel>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {hasPawn ? (
          <Attn
            n={attention.dueThisWeekCount}
            label={d.attnDueWeek}
            icon={<Calendar size={16} weight="bold" />}
            tone="amber"
            href="/pawn?status=active&due=dueSoon7"
          />
        ) : null}
        {hasPawn ? (
          <Attn
            n={attention.overdueLoanCount}
            label={d.attnOverdue}
            icon={<Clock size={16} weight="bold" />}
            tone="red"
            href="/pawn?status=active&due=overdue"
          />
        ) : null}
        <Attn
          n={attention.heldCount}
          label={d.attnHold}
          icon={<Lock size={16} weight="bold" />}
          tone="navy"
          href="/inventory?status=held"
        />
        {hasRepair ? (
          <Attn
            n={attention.readyForPickupCount}
            label={d.attnReady}
            icon={<CheckCircle size={16} weight="bold" />}
            tone="green"
            href="/repair?status=ready"
          />
        ) : null}
        {hasRepair ? (
          <Attn
            n={attention.repairsNeedPartsCount}
            label={d.attnNeedParts}
            icon={<Wrench size={16} weight="bold" />}
            tone="amber"
            href="/repair?status=needs_parts"
          />
        ) : null}
      </div>

      {/* Lower two-column */}
      <div className="grid grid-cols-1 gap-4 pt-5 lg:grid-cols-2">
        {hasPawn ? (
          <Panel title={d.panelDueSoon} seeAllHref="/pawn" seeAllLabel={d.seeAll}>
            {loansDueSoon.length === 0 ? (
              <Empty>{d.emptyDueSoon}</Empty>
            ) : (
              loansDueSoon.map((l) => (
                <Link
                  key={l.id}
                  href={`/pawn/${l.id}`}
                  className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0 hover:bg-background"
                >
                  <span className="w-20 shrink-0 font-mono text-xs font-bold text-navy">
                    {l.ticket_number}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-foreground">
                      {l.customer_name}
                    </div>
                    <div className={`text-[11px] font-bold ${relTone(l.days)}`}>
                      {relLabel(l.days, d)}
                    </div>
                  </div>
                  <span className="font-mono text-sm font-bold tabular-nums text-foreground">
                    {fmtMoney(l.payoff)}
                  </span>
                </Link>
              ))
            )}
          </Panel>
        ) : null}

        <Panel
          title={d.panelActivity}
          seeAllHref="/reports"
          seeAllLabel={d.seeAll}
        >
          {activity.length === 0 ? (
            <Empty>{d.emptyActivity}</Empty>
          ) : (
            activity.map((a) => (
              <Link
                key={a.id}
                href={a.href}
                className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0 hover:bg-background"
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${activityChip(a.kind)}`}
                >
                  {activityIcon(a.kind)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-foreground">
                    {activityTitle(a, d)}
                  </div>
                  {a.subtitle ? (
                    <div className="truncate text-[11.5px] font-semibold text-muted">
                      {a.subtitle}
                    </div>
                  ) : null}
                </div>
                {a.amount != null ? (
                  <span className="font-mono text-sm font-bold tabular-nums text-foreground">
                    {fmtMoney(a.amount)}
                  </span>
                ) : null}
                <span className="w-14 shrink-0 text-right text-[11px] font-semibold text-muted">
                  {relativeTime(a.occurredAt)}
                </span>
              </Link>
            ))
          )}
        </Panel>
      </div>

      {/* Library */}
      <SectionLabel>{d.sectionLibrary}</SectionLabel>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <LibCard
          n={library.customerCount}
          label={d.libCustomers}
          icon={<Users size={18} weight="regular" />}
          href="/customers"
        />
        <LibCard
          n={library.inventoryCount}
          label={d.libInventory}
          icon={<Package size={18} weight="regular" />}
          href="/inventory?status=available"
        />
        <LibCard
          n={library.bannedCount}
          label={d.libBanned}
          icon={<Prohibit size={18} weight="regular" />}
          href="/customers?banned=1"
        />
      </div>
    </div>
  )
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="pb-1 pt-5 text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
      {children}
    </div>
  )
}

function QuickAction({
  accent,
  icon,
  title,
  sub,
  href,
}: {
  accent: 'success' | 'gold' | 'blue'
  icon: React.ReactNode
  title: string
  sub: string
  href: string
}) {
  const bar =
    accent === 'success'
      ? 'before:bg-success'
      : accent === 'gold'
      ? 'before:bg-gold'
      : 'before:bg-blue'
  const chip =
    accent === 'success'
      ? 'bg-success/10 text-success'
      : accent === 'gold'
      ? 'bg-gold/15 text-gold'
      : 'bg-blue/10 text-blue'
  return (
    <Link
      href={href}
      className={`group relative flex items-center gap-3.5 overflow-hidden rounded-xl border border-border bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg before:absolute before:inset-y-0 before:left-0 before:w-1 ${bar}`}
    >
      <span
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${chip}`}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-base font-bold text-foreground">{title}</div>
        <div className="text-xs font-semibold text-muted">{sub}</div>
      </div>
      <CaretRight
        size={18}
        weight="bold"
        className="ml-auto text-border transition-colors group-hover:text-foreground"
      />
    </Link>
  )
}

function Kpi({
  accent,
  label,
  value,
  valueClass,
  sub,
}: {
  accent: string
  label: string
  value: string
  valueClass?: string
  sub: string
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-card p-4 shadow-sm">
      <span className={`absolute inset-y-0 left-0 w-1 ${accent}`} />
      <div className="text-[11px] font-bold uppercase tracking-wide text-muted">
        {label}
      </div>
      <div
        className={`mt-1.5 font-mono text-2xl font-bold tracking-tight ${valueClass ?? 'text-foreground'}`}
      >
        {value}
      </div>
      <div className="mt-0.5 text-xs font-semibold text-muted">{sub}</div>
    </div>
  )
}

function Attn({
  n,
  label,
  icon,
  tone,
  href,
}: {
  n: number
  label: string
  icon: React.ReactNode
  tone: 'red' | 'amber' | 'green' | 'navy'
  href: string
}) {
  const zero = n === 0
  const palette: Record<
    'red' | 'amber' | 'green' | 'navy',
    { box: string; num: string; chip: string }
  > = {
    red: {
      box: 'border-danger/30 bg-danger/5',
      num: 'text-danger',
      chip: 'bg-danger/10 text-danger',
    },
    amber: {
      box: 'border-warning/30 bg-warning/5',
      num: 'text-warning',
      chip: 'bg-warning/10 text-warning',
    },
    green: {
      box: 'border-success/30 bg-success/5',
      num: 'text-success',
      chip: 'bg-success/10 text-success',
    },
    navy: {
      box: 'border-border bg-card',
      num: 'text-navy',
      chip: 'bg-navy/5 text-navy',
    },
  }
  const p = palette[tone]
  return (
    <Link
      href={href}
      className={`rounded-xl border p-4 transition-all hover:-translate-y-0.5 hover:shadow-sm ${
        zero ? 'border-border bg-card opacity-60' : p.box
      }`}
    >
      <div className="flex items-center justify-between">
        <span
          className={`text-2xl font-bold tabular-nums ${zero ? 'text-muted' : p.num}`}
        >
          {n}
        </span>
        <span
          className={`flex h-7 w-7 items-center justify-center rounded-lg ${
            zero ? 'bg-background text-muted' : p.chip
          }`}
        >
          {icon}
        </span>
      </div>
      <div className="mt-2 text-xs font-bold text-muted">{label}</div>
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
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <header className="flex items-center justify-between border-b border-border px-4 py-3.5">
        <h3 className="text-sm font-bold text-foreground">{title}</h3>
        <Link
          href={seeAllHref}
          className="text-xs font-bold text-gold hover:underline"
        >
          {seeAllLabel} →
        </Link>
      </header>
      {children}
    </section>
  )
}

function LibCard({
  n,
  label,
  icon,
  href,
}: {
  n: number
  label: string
  icon: React.ReactNode
  href: string
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-xl border border-border bg-card p-3.5 transition-all hover:-translate-y-0.5 hover:shadow-sm"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background text-muted">
        {icon}
      </span>
      <div>
        <div className="text-lg font-bold tabular-nums text-foreground">{n}</div>
        <div className="text-xs font-semibold text-muted">{label}</div>
      </div>
    </Link>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-8 text-center text-sm text-muted">{children}</div>
}

// ── Helpers ─────────────────────────────────────────────────────────────────

type Dict = ReturnType<typeof useI18n>['t']['dashboard']

function activityChip(kind: ActivityRow['kind']): string {
  switch (kind) {
    case 'sale':
      return 'bg-success/10 text-success'
    case 'loan':
      return 'bg-gold/15 text-gold'
    case 'pay':
      return 'bg-blue/10 text-blue'
    case 'redeem':
      return 'bg-background text-muted'
  }
}

function activityIcon(kind: ActivityRow['kind']): React.ReactNode {
  switch (kind) {
    case 'sale':
      return <ShoppingBag size={16} weight="bold" />
    case 'loan':
      return <Coins size={16} weight="bold" />
    case 'pay':
      return <HandCoins size={16} weight="bold" />
    case 'redeem':
      return <CheckCircle size={16} weight="bold" />
  }
}

function activityTitle(a: ActivityRow, d: Dict): string {
  if (a.kind === 'sale') return `${d.actSale} · ${a.title}`
  const prefix =
    a.eventType === 'redemption'
      ? d.actRedemption
      : a.eventType === 'issued'
      ? d.actNewLoan
      : a.eventType === 'extension'
      ? d.actExtension
      : d.actPayment
  return `${prefix} · ${a.title}`
}

function relTone(days: number): string {
  if (days < 0) return 'text-danger'
  if (days <= 7) return 'text-warning'
  return 'text-muted'
}

function relLabel(days: number, d: Dict): string {
  if (days < 0) return d.relOverdue.replace('{n}', String(Math.abs(days)))
  if (days === 0) return d.relDueToday
  return d.relDueIn.replace('{n}', String(days))
}

function fmtMoney(v: number): string {
  if (!isFinite(v)) return '—'
  return v.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  })
}

function formatDateLong(isoDate: string): string {
  const dt = new Date(`${isoDate}T00:00:00`)
  if (isNaN(dt.getTime())) return ''
  return dt.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function relativeTime(iso: string): string {
  const ts = new Date(iso).getTime()
  if (!isFinite(ts)) return ''
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const dd = Math.floor(h / 24)
  if (dd < 7) return `${dd}d`
  return new Date(iso).toLocaleDateString()
}
