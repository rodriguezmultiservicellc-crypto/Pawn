'use client'

import Link from 'next/link'
import {
  ArrowLeft,
  Coins,
  CashRegister,
  Wrench,
  ShoppingBag,
  Lock,
  Prohibit,
  TrendUp,
  Star,
  Clock,
  Receipt,
  Warning,
  CalendarBlank,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'

export type MonthlyBucket = {
  key: string
  label: string
  pawns: number
  sales: number
  repairs: number
  layaways: number
}

export type ForfeitedLoanRow = {
  id: string
  ticket_number: string
  principal: number
  forfeited_at: string
  items: Array<{
    description: string
    weight_grams: number | null
    est_value: number
  }>
}

export type ActivityEvent = {
  kind: 'loan_event' | 'sale' | 'repair' | 'layaway'
  id: string
  occurred_at: string
  label: string
  amount: number | null
  ticket_number: string | null
  detail: string | null
}

type CustomerHeader = {
  id: string
  first_name: string
  last_name: string
  photo_url: string | null
  phone: string | null
  email: string | null
  is_banned: boolean
  banned_reason: string | null
  loyalty_points_balance: number
  created_at: string
}

type ModuleGates = {
  hasPawn: boolean
  hasRepair: boolean
  hasRetail: boolean
}

type LifetimeStats = {
  totalPawns: number
  totalLoaned: number
  activeLoans: number
  forfeitedLoansCount: number
  totalSalesCount: number
  totalSpent: number
  totalRepairs: number
  repairsActive: number
  totalLayaways: number
  activeLayaways: number
  interestPaidLifetime: number
  extensionCount: number
  onTimePct: number | null
}

type PawnBehavior = {
  avgPrincipal: number | null
  redemptionRatePct: number | null
  forfeitRatePct: number | null
  extensionRatePct: number | null
  avgDaysLate: number | null
}

export default function CustomerAnalyticsDashboard({
  customer,
  gates,
  lifetime,
  pawnBehavior,
  trends,
  forfeited,
  activity,
}: {
  customer: CustomerHeader
  gates: ModuleGates
  lifetime: LifetimeStats
  pawnBehavior: PawnBehavior
  trends: MonthlyBucket[]
  forfeited: ForfeitedLoanRow[]
  activity: ActivityEvent[]
}) {
  const { t } = useI18n()
  const cd = t.customers.dashboard

  const since = new Date(customer.created_at)
  const sinceLabel = since.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
  const sinceMonths = Math.max(
    0,
    Math.round(
      (Date.now() - since.getTime()) / (1000 * 60 * 60 * 24 * 30.44),
    ),
  )

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="flex flex-wrap items-start gap-4">
        <Link
          href={`/customers/${customer.id}`}
          className="inline-flex items-center gap-1 text-sm font-semibold text-muted transition-colors hover:text-blue"
        >
          <ArrowLeft size={14} weight="bold" />
          {cd.backToCustomer}
        </Link>
        <div className="flex flex-1 items-start gap-4 min-w-0">
          {customer.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={customer.photo_url}
              alt=""
              className="h-20 w-20 shrink-0 rounded-xl object-cover"
            />
          ) : (
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-navy/5 font-display text-2xl font-bold text-navy">
              {(customer.first_name?.[0] ?? '').toUpperCase()}
              {(customer.last_name?.[0] ?? '').toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-3xl font-bold text-navy">
              {customer.last_name}, {customer.first_name}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
              <span className="inline-flex items-center gap-1">
                <CalendarBlank size={14} weight="regular" />
                {cd.customerSince} {sinceLabel}
                {sinceMonths > 0
                  ? ` · ${sinceMonths} ${cd.monthsAbbrev}`
                  : ''}
              </span>
              {customer.phone ? <span>{customer.phone}</span> : null}
              {customer.email ? (
                <span className="truncate">{customer.email}</span>
              ) : null}
            </div>
            {customer.is_banned ? (
              <div className="mt-2 inline-flex items-center gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-1 text-xs font-semibold text-danger">
                <Prohibit size={14} weight="bold" />
                {cd.bannedFlag}
                {customer.banned_reason ? ` — ${customer.banned_reason}` : ''}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* LIFETIME STATS */}
      <section className="space-y-3">
        <h2 className="font-display text-xl font-bold text-navy">
          {cd.lifetimeStatsTitle}
        </h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {gates.hasPawn ? (
            <>
              <StatCard
                label={cd.statPawns}
                value={lifetime.totalPawns.toString()}
                icon={<Coins size={14} weight="regular" />}
                accent="gold"
              />
              <StatCard
                label={cd.statLoaned}
                value={formatMoney(lifetime.totalLoaned)}
                icon={<Coins size={14} weight="regular" />}
                accent="gold"
              />
              <StatCard
                label={cd.statActive}
                value={lifetime.activeLoans.toString()}
                icon={<Clock size={14} weight="regular" />}
                accent="info"
              />
              <StatCard
                label={cd.statLost}
                value={lifetime.forfeitedLoansCount.toString()}
                icon={<Lock size={14} weight="regular" />}
                accent={
                  lifetime.forfeitedLoansCount > 0 ? 'danger' : 'neutral'
                }
              />
            </>
          ) : null}

          {gates.hasRetail ? (
            <>
              <StatCard
                label={cd.statSales}
                value={lifetime.totalSalesCount.toString()}
                icon={<CashRegister size={14} weight="regular" />}
                accent="success"
              />
              <StatCard
                label={cd.statSpent}
                value={formatMoney(lifetime.totalSpent)}
                icon={<Receipt size={14} weight="regular" />}
                accent="success"
              />
            </>
          ) : null}

          {gates.hasRepair ? (
            <StatCard
              label={cd.statRepairs}
              value={`${lifetime.totalRepairs}${
                lifetime.repairsActive > 0
                  ? ` (${lifetime.repairsActive} ${cd.activeAbbrev})`
                  : ''
              }`}
              icon={<Wrench size={14} weight="regular" />}
              accent="info"
            />
          ) : null}

          {gates.hasRetail ? (
            <StatCard
              label={cd.statLayaways}
              value={`${lifetime.totalLayaways}${
                lifetime.activeLayaways > 0
                  ? ` (${lifetime.activeLayaways} ${cd.activeAbbrev})`
                  : ''
              }`}
              icon={<ShoppingBag size={14} weight="regular" />}
              accent="success"
            />
          ) : null}

          {gates.hasPawn ? (
            <>
              <StatCard
                label={cd.statInterestPaid}
                value={formatMoney(lifetime.interestPaidLifetime)}
                icon={<Coins size={14} weight="regular" />}
                accent="gold"
              />
              <StatCard
                label={cd.statExtensions}
                value={lifetime.extensionCount.toString()}
                icon={<TrendUp size={14} weight="regular" />}
                accent="warning"
              />
              <StatCard
                label={cd.statOnTime}
                value={
                  lifetime.onTimePct == null
                    ? '—'
                    : `${lifetime.onTimePct}%`
                }
                icon={<Clock size={14} weight="regular" />}
                accent={
                  lifetime.onTimePct == null
                    ? 'neutral'
                    : lifetime.onTimePct >= 80
                    ? 'success'
                    : lifetime.onTimePct >= 50
                    ? 'warning'
                    : 'danger'
                }
              />
            </>
          ) : null}

          <StatCard
            label={cd.statLoyalty}
            value={`${customer.loyalty_points_balance} ${cd.pointsAbbrev}`}
            icon={<Star size={14} weight="regular" />}
            accent="info"
          />
        </div>
      </section>

      {/* PAWN BEHAVIOR */}
      {gates.hasPawn && lifetime.totalPawns > 0 ? (
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-display text-xl font-bold text-navy">
            {cd.pawnBehaviorTitle}
          </h2>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
            <Metric
              label={cd.behaviorAvgPrincipal}
              value={
                pawnBehavior.avgPrincipal == null
                  ? '—'
                  : formatMoney(pawnBehavior.avgPrincipal)
              }
            />
            <Metric
              label={cd.behaviorRedemptionRate}
              value={
                pawnBehavior.redemptionRatePct == null
                  ? '—'
                  : `${pawnBehavior.redemptionRatePct}%`
              }
            />
            <Metric
              label={cd.behaviorForfeitRate}
              value={
                pawnBehavior.forfeitRatePct == null
                  ? '—'
                  : `${pawnBehavior.forfeitRatePct}%`
              }
              tone={
                pawnBehavior.forfeitRatePct != null &&
                pawnBehavior.forfeitRatePct >= 25
                  ? 'danger'
                  : 'neutral'
              }
            />
            <Metric
              label={cd.behaviorExtensionRate}
              value={
                pawnBehavior.extensionRatePct == null
                  ? '—'
                  : `${pawnBehavior.extensionRatePct}%`
              }
            />
            <Metric
              label={cd.behaviorAvgDaysLate}
              value={
                pawnBehavior.avgDaysLate == null
                  ? '—'
                  : `${pawnBehavior.avgDaysLate}d`
              }
            />
          </div>
        </section>
      ) : null}

      {/* TRENDS — 12 MONTHS */}
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-display text-xl font-bold text-navy">
          {cd.trendsTitle}
        </h2>
        <p className="mt-1 text-xs text-muted">{cd.trendsSubtitle}</p>
        <TrendChart buckets={trends} gates={gates} t={cd} />
      </section>

      {/* LOST PAWNS */}
      {gates.hasPawn ? (
        <section className="rounded-xl border border-border bg-card">
          <header className="flex items-center justify-between border-b border-border px-5 py-3">
            <h2 className="font-display text-xl font-bold text-navy">
              {cd.lostPawnsTitle}
            </h2>
            <span className="text-xs text-muted">
              {forfeited.length} {cd.lostPawnsCount}
            </span>
          </header>
          {forfeited.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-muted">
              {cd.lostPawnsEmpty}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {forfeited.map((l) => (
                <li
                  key={l.id}
                  className="flex flex-col gap-1 px-5 py-3 text-sm sm:flex-row sm:items-center sm:gap-4"
                >
                  <div className="shrink-0 text-xs text-muted">
                    {new Date(l.forfeited_at).toLocaleDateString()}
                  </div>
                  <div className="shrink-0 font-mono text-xs font-semibold text-foreground">
                    {l.ticket_number || '—'}
                  </div>
                  <div className="shrink-0 font-mono text-sm text-foreground">
                    {formatMoney(l.principal)}
                  </div>
                  <div className="min-w-0 flex-1 text-foreground">
                    {l.items.length > 0 ? (
                      l.items
                        .map(
                          (it) =>
                            `${it.description}${
                              it.weight_grams ? ` (${it.weight_grams}g)` : ''
                            }`,
                        )
                        .join(', ')
                    ) : (
                      <span className="text-muted">{cd.noCollateralListed}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {/* RECENT ACTIVITY */}
      <section className="rounded-xl border border-border bg-card">
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="font-display text-xl font-bold text-navy">
            {cd.activityTitle}
          </h2>
          <span className="text-xs text-muted">{cd.activityWindow}</span>
        </header>
        {activity.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-muted">
            {cd.activityEmpty}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {activity.map((e) => (
              <li
                key={`${e.kind}-${e.id}`}
                className="flex items-center gap-3 px-5 py-2.5 text-sm"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-navy/5 text-navy">
                  {iconForActivityKind(e.kind)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-foreground">
                    {labelForActivity(e, cd)}
                  </div>
                  {e.detail ? (
                    <div className="truncate text-xs text-muted">
                      {e.detail}
                    </div>
                  ) : null}
                </div>
                {e.amount != null ? (
                  <div className="shrink-0 font-mono text-sm font-semibold text-foreground">
                    {formatMoney(e.amount)}
                  </div>
                ) : null}
                <div className="shrink-0 text-xs text-muted">
                  {relativeDate(e.occurred_at)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

// ─── PRESENTATIONAL HELPERS ──────────────────────────────────────────

type StatAccent = 'gold' | 'info' | 'success' | 'warning' | 'danger' | 'neutral'

function StatCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string
  value: string
  icon: React.ReactNode
  accent: StatAccent
}) {
  const palette: Record<StatAccent, { border: string; chip: string; valueColor: string }> = {
    gold: { border: 'border-border bg-card', chip: 'bg-gold/10 text-gold', valueColor: 'text-foreground' },
    info: { border: 'border-border bg-card', chip: 'bg-blue/10 text-blue', valueColor: 'text-foreground' },
    success: { border: 'border-border bg-card', chip: 'bg-success/10 text-success', valueColor: 'text-foreground' },
    warning: { border: 'border-warning/40 bg-warning/5', chip: 'bg-warning/10 text-warning', valueColor: 'text-warning' },
    danger: { border: 'border-danger/40 bg-danger/5', chip: 'bg-danger/10 text-danger', valueColor: 'text-danger' },
    neutral: { border: 'border-border bg-card', chip: 'bg-navy/5 text-navy', valueColor: 'text-foreground' },
  }
  const p = palette[accent]
  return (
    <div className={`flex flex-col gap-1 rounded-lg border p-2.5 ${p.border}`}>
      <div className="flex items-center justify-between gap-1">
        <span className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted">
          {label}
        </span>
        <span
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${p.chip}`}
        >
          {icon}
        </span>
      </div>
      <div className={`font-mono text-lg font-bold leading-tight ${p.valueColor}`}>
        {value}
      </div>
    </div>
  )
}

function Metric({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'neutral' | 'danger'
}) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">
        {label}
      </div>
      <div
        className={`font-mono text-lg font-bold ${
          tone === 'danger' ? 'text-danger' : 'text-foreground'
        }`}
      >
        {value}
      </div>
    </div>
  )
}

function TrendChart({
  buckets,
  gates,
  t,
}: {
  buckets: MonthlyBucket[]
  gates: ModuleGates
  t: ReturnType<typeof useI18n>['t']['customers']['dashboard']
}) {
  // Compute max stack height for normalizing bar heights.
  const maxTotal = Math.max(
    1,
    ...buckets.map((b) => {
      let total = 0
      if (gates.hasPawn) total += b.pawns
      if (gates.hasRetail) total += b.sales + b.layaways
      if (gates.hasRepair) total += b.repairs
      return total
    }),
  )
  const chartHeight = 140
  return (
    <div className="mt-3">
      <div className="flex items-end gap-1.5" style={{ height: chartHeight }}>
        {buckets.map((b) => {
          const segments: Array<{ value: number; color: string; key: string }> =
            []
          if (gates.hasPawn && b.pawns > 0) {
            segments.push({ value: b.pawns, color: 'bg-gold', key: 'pawns' })
          }
          if (gates.hasRetail && b.sales > 0) {
            segments.push({
              value: b.sales,
              color: 'bg-success',
              key: 'sales',
            })
          }
          if (gates.hasRepair && b.repairs > 0) {
            segments.push({
              value: b.repairs,
              color: 'bg-blue',
              key: 'repairs',
            })
          }
          if (gates.hasRetail && b.layaways > 0) {
            segments.push({
              value: b.layaways,
              color: 'bg-success/60',
              key: 'layaways',
            })
          }
          const total =
            (gates.hasPawn ? b.pawns : 0) +
            (gates.hasRetail ? b.sales + b.layaways : 0) +
            (gates.hasRepair ? b.repairs : 0)
          return (
            <div key={b.key} className="flex flex-1 flex-col items-center">
              <div
                className="flex w-full flex-col-reverse overflow-hidden rounded-t-md bg-background"
                style={{ height: `${(total / maxTotal) * chartHeight}px` }}
                title={`${b.label}: ${total} (pawns ${b.pawns} / sales ${b.sales} / repairs ${b.repairs} / layaways ${b.layaways})`}
              >
                {segments.map((s) => (
                  <div
                    key={s.key}
                    className={s.color}
                    style={{ height: `${(s.value / total) * 100}%` }}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-1 flex gap-1.5">
        {buckets.map((b) => (
          <div
            key={b.key}
            className="flex-1 text-center text-[10px] uppercase tracking-wide text-muted"
          >
            {b.label}
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted">
        {gates.hasPawn ? (
          <Legend swatch="bg-gold" label={t.legendPawns} />
        ) : null}
        {gates.hasRetail ? (
          <Legend swatch="bg-success" label={t.legendSales} />
        ) : null}
        {gates.hasRepair ? (
          <Legend swatch="bg-blue" label={t.legendRepairs} />
        ) : null}
        {gates.hasRetail ? (
          <Legend swatch="bg-success/60" label={t.legendLayaways} />
        ) : null}
      </div>
    </div>
  )
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-2.5 w-2.5 rounded-sm ${swatch}`} />
      {label}
    </span>
  )
}

function iconForActivityKind(kind: ActivityEvent['kind']): React.ReactNode {
  switch (kind) {
    case 'loan_event':
      return <Coins size={16} weight="regular" />
    case 'sale':
      return <CashRegister size={16} weight="regular" />
    case 'repair':
      return <Wrench size={16} weight="regular" />
    case 'layaway':
      return <ShoppingBag size={16} weight="regular" />
    default:
      return <Warning size={16} weight="regular" />
  }
}

function labelForActivity(
  e: ActivityEvent,
  cd: ReturnType<typeof useI18n>['t']['customers']['dashboard'],
): string {
  const ticket = e.ticket_number ? ` ${e.ticket_number}` : ''
  switch (e.kind) {
    case 'loan_event':
      return `${cd.activityLoanEventPrefix} ${e.label}${ticket}`
    case 'sale':
      return `${cd.activitySalePrefix} ${e.label}${ticket}`
    case 'repair':
      return `${cd.activityRepairPrefix} ${e.label}${ticket}`
    case 'layaway':
      return `${cd.activityLayawayPrefix} ${e.label}${ticket}`
    default:
      return e.label
  }
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

function formatMoney(v: number): string {
  if (!isFinite(v)) return '—'
  return v.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}
