'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  MagnifyingGlass,
  Plus,
  Coins,
  DotsThree,
  CaretUp,
  CaretDown,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { daysBetween } from '@/lib/pawn/math'
import type { LoanStatus } from '@/types/database-aliases'

export type PawnListRow = {
  id: string
  ticket_number: string
  customer_id: string
  customer_name: string
  customer_phone: string | null
  principal: number | string
  interest_rate_monthly: number | string
  term_days: number
  issue_date: string
  due_date: string
  status: LoanStatus
  is_printed: boolean
  created_at: string
  collateral_label: string | null
  collateral_extra: number
  payoff: number | null
  accrued_interest: number | null
}

export type Counts = {
  active: number
  overdue: number
  dueSoon7: number
  redeemed: number
  forfeited: number
  voided: number
}

export type PawnStats = {
  onLoanNow: number
  activeCount: number
  dueSoonCount: number
  dueSoonValue: number
  overdueCount: number
  overdueValue: number
  redeemedCount: number
  redeemedInterest: number
}

type SortKey = 'due' | 'principal' | 'payoff'

const TERMINAL: ReadonlyArray<LoanStatus> = ['redeemed', 'forfeited', 'voided']

const STATUS_BADGE: Record<LoanStatus, string> = {
  active: 'bg-success/10 text-success',
  extended: 'bg-success/10 text-success',
  partial_paid: 'bg-warning/10 text-warning',
  redeemed: 'bg-background text-muted',
  forfeited: 'bg-navy/10 text-navy',
  voided: 'bg-background text-muted',
}

export default function PawnContent({
  rows,
  query,
  statusFilter,
  dueWindow,
  customerFilter,
  counts,
  stats,
  today,
}: {
  rows: PawnListRow[]
  query: string
  statusFilter: string
  dueWindow: string
  customerFilter: string
  counts: Counts
  stats: PawnStats
  today: string
}) {
  const { t } = useI18n()
  const router = useRouter()
  const sp = useSearchParams()
  const [searchInput, setSearchInput] = useState(query)
  const [pending, startTransition] = useTransition()
  const [sortKey, setSortKey] = useState<SortKey>('due')
  const [sortDir, setSortDir] = useState<1 | -1>(1)

  function pushParams(next: Record<string, string | null>) {
    const usp = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(next)) {
      if (v == null || v === '') usp.delete(k)
      else usp.set(k, v)
    }
    startTransition(() => {
      router.push(`/pawn${usp.toString() ? `?${usp.toString()}` : ''}`)
    })
  }

  function onSearchSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    pushParams({ q: searchInput.trim() })
  }

  function setSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 1 ? -1 : 1))
    else {
      setSortKey(key)
      setSortDir(1)
    }
  }

  const sorted = [...rows].sort((a, b) => {
    let av: number
    let bv: number
    if (sortKey === 'due') {
      av = daysBetween(today, a.due_date)
      bv = daysBetween(today, b.due_date)
    } else if (sortKey === 'principal') {
      av = toNum(a.principal)
      bv = toNum(b.principal)
    } else {
      av = a.payoff ?? Number.POSITIVE_INFINITY
      bv = b.payoff ?? Number.POSITIVE_INFINITY
    }
    return (av > bv ? 1 : av < bv ? -1 : 0) * sortDir
  })

  const hasFilter =
    !!query ||
    statusFilter !== 'active' ||
    dueWindow !== 'all' ||
    !!customerFilter

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold">{t.pawn.title}</h1>
        <Link
          href="/pawn/new"
          className="inline-flex items-center gap-1 rounded-xl bg-gold px-5 py-3 text-sm font-bold text-navy shadow-lg transition-all hover:-translate-y-0.5 hover:bg-gold-2"
        >
          <Plus size={16} weight="bold" />
          <span>{t.pawn.new}</span>
        </Link>
      </div>

      {/* Summary stats strip */}
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <StatCard
          accent="bg-navy"
          label={t.pawn.list.statOnLoan}
          value={fmtMoney(stats.onLoanNow)}
          sub={t.pawn.list.statOnLoanSub.replace('{n}', String(stats.activeCount))}
        />
        <StatCard
          accent="bg-warning"
          label={t.pawn.list.statDueSoon}
          value={String(stats.dueSoonCount)}
          sub={t.pawn.list.statDueSoonSub.replace(
            '{amount}',
            fmtMoney(stats.dueSoonValue),
          )}
        />
        <StatCard
          accent="bg-danger"
          label={t.pawn.list.statOverdue}
          value={String(stats.overdueCount)}
          valueClass="text-danger"
          sub={t.pawn.list.statOverdueSub.replace(
            '{amount}',
            fmtMoney(stats.overdueValue),
          )}
        />
        <StatCard
          accent="bg-success"
          label={t.pawn.list.statRedeemed}
          value={String(stats.redeemedCount)}
          sub={t.pawn.list.statRedeemedSub.replace(
            '{amount}',
            fmtMoney(stats.redeemedInterest),
          )}
          subClass="text-success"
        />
      </div>

      {/* Status chips */}
      <div className="flex flex-wrap gap-2">
        <Chip
          label={t.pawn.list.filterActive}
          count={counts.active}
          active={statusFilter === 'active' && dueWindow === 'all'}
          onClick={() => pushParams({ status: 'active', due: null })}
        />
        <Chip
          label={t.pawn.list.filterOverdue}
          count={counts.overdue}
          active={dueWindow === 'overdue'}
          tone="error"
          onClick={() => pushParams({ status: 'active', due: 'overdue' })}
        />
        <Chip
          label={t.pawn.list.filterDueSoon}
          count={counts.dueSoon7}
          active={dueWindow === 'dueSoon7'}
          tone="warning"
          onClick={() => pushParams({ status: 'active', due: 'dueSoon7' })}
        />
        <Chip
          label={t.pawn.list.filterRedeemed}
          count={counts.redeemed}
          active={statusFilter === 'redeemed'}
          onClick={() => pushParams({ status: 'redeemed', due: null })}
        />
        <Chip
          label={t.pawn.list.filterForfeited}
          count={counts.forfeited}
          active={statusFilter === 'forfeited'}
          onClick={() => pushParams({ status: 'forfeited', due: null })}
        />
        <Chip
          label={t.pawn.list.filterVoided}
          count={counts.voided}
          active={statusFilter === 'voided'}
          onClick={() => pushParams({ status: 'voided', due: null })}
        />
        <Chip
          label={t.pawn.list.filterAll}
          count={null}
          active={statusFilter === 'all'}
          onClick={() => pushParams({ status: 'all', due: null })}
        />
      </div>

      {/* Toolbar */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
        <form
          onSubmit={onSearchSubmit}
          className="flex items-center gap-2 sm:col-span-7"
        >
          <div className="relative flex-1">
            <MagnifyingGlass
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t.pawn.list.searchPlaceholder}
              className="block w-full rounded-xl border border-border bg-card py-2.5 pl-9 pr-3 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
            />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground hover:bg-background disabled:opacity-50"
          >
            {t.common.search}
          </button>
        </form>

        <select
          value={dueWindow}
          onChange={(e) => pushParams({ due: e.target.value })}
          className="rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-medium text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10 sm:col-span-4"
        >
          <option value="all">{t.pawn.list.dueWindowAll}</option>
          <option value="overdue">{t.pawn.list.dueWindowOverdue}</option>
          <option value="dueSoon7">{t.pawn.list.dueWindowDueSoon7}</option>
          <option value="dueSoon14">{t.pawn.list.dueWindowDueSoon14}</option>
        </select>

        {hasFilter ? (
          <button
            type="button"
            onClick={() => {
              setSearchInput('')
              pushParams({ q: null, status: null, due: null, customer: null })
            }}
            className="rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground hover:bg-background sm:col-span-1"
          >
            {t.common.clear}
          </button>
        ) : null}
      </div>

      {/* Table */}
      {rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <Coins size={32} weight="light" className="mx-auto mb-3 text-muted" />
          <p className="text-muted">
            {hasFilter ? t.pawn.list.emptyForFilter : t.pawn.list.empty}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead className="border-b border-border text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3 font-bold">{t.pawn.list.ticket}</th>
                <th className="px-4 py-3 font-bold">{t.pawn.list.customer}</th>
                <th className="px-4 py-3 font-bold">{t.pawn.list.collateral}</th>
                <SortHeader
                  label={t.pawn.list.principal}
                  active={sortKey === 'principal'}
                  dir={sortDir}
                  onClick={() => setSort('principal')}
                />
                <SortHeader
                  label={t.pawn.list.payoffDue}
                  active={sortKey === 'payoff'}
                  dir={sortDir}
                  onClick={() => setSort('payoff')}
                />
                <SortHeader
                  label={t.pawn.list.dueDate}
                  active={sortKey === 'due'}
                  dir={sortDir}
                  onClick={() => setSort('due')}
                />
                <th className="px-4 py-3 font-bold">{t.pawn.list.status}</th>
                <th className="px-4 py-3 text-right font-bold">
                  {t.common.actions}
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const isTerminal = TERMINAL.includes(r.status)
                const days = daysBetween(today, r.due_date)
                const isOverdue = !isTerminal && days < 0
                const isDueSoon = !isTerminal && days >= 0 && days <= 7
                const accent = isOverdue
                  ? 'border-l-danger'
                  : isDueSoon
                  ? 'border-l-warning'
                  : 'border-l-transparent'
                return (
                  <tr
                    key={r.id}
                    className="cursor-pointer border-b border-border transition-colors last:border-b-0 hover:bg-background"
                    onClick={() => router.push(`/pawn/${r.id}`)}
                  >
                    <td
                      className={`border-l-4 ${accent} px-4 py-3 font-mono text-xs font-bold text-navy`}
                    >
                      {r.ticket_number}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-foreground">
                        {r.customer_name}
                      </div>
                      {r.customer_phone ? (
                        <div className="text-xs text-muted">
                          {r.customer_phone}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {r.collateral_label ? (
                        <span className="font-medium text-foreground">
                          {r.collateral_label}
                          {r.collateral_extra > 0 ? (
                            <span className="ml-1 text-xs font-bold text-muted">
                              {t.pawn.list.moreCount.replace(
                                '{n}',
                                String(r.collateral_extra),
                              )}
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-foreground">
                      {fmtMoney(r.principal)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {r.payoff == null ? (
                        <span className="text-muted">—</span>
                      ) : (
                        <span className="font-bold text-foreground">
                          {fmtMoney(r.payoff)}
                          {r.accrued_interest && r.accrued_interest > 0 ? (
                            <span className="block text-[10px] font-semibold text-muted">
                              +{fmtMoney(r.accrued_interest)} {t.pawn.list.intSuffix}
                            </span>
                          ) : null}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-mono text-xs font-semibold text-foreground">
                        {r.due_date}
                      </div>
                      <div
                        className={`text-[11px] font-bold ${
                          isOverdue
                            ? 'text-danger'
                            : isDueSoon
                            ? 'text-warning'
                            : 'text-muted'
                        }`}
                      >
                        {isTerminal
                          ? '—'
                          : isOverdue
                          ? t.pawn.list.relOverdue.replace(
                              '{n}',
                              String(Math.abs(days)),
                            )
                          : t.pawn.list.relDueIn.replace('{n}', String(days))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold ${STATUS_BADGE[r.status]}`}
                      >
                        {labelForStatus(r.status, t)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div
                        className="flex items-center justify-end gap-1.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {isTerminal ? (
                          <button
                            type="button"
                            onClick={() => router.push(`/pawn/${r.id}`)}
                            className="whitespace-nowrap rounded-lg bg-background px-3 py-1.5 text-xs font-bold text-muted hover:bg-border"
                          >
                            {t.pawn.list.view}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => router.push(`/pawn/${r.id}`)}
                            className="whitespace-nowrap rounded-lg bg-navy px-3 py-1.5 text-xs font-bold text-white hover:bg-navy/90"
                          >
                            {t.pawn.list.takePayment}
                          </button>
                        )}
                        <RowMenu row={r} isTerminal={isTerminal} />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function StatCard({
  accent,
  label,
  value,
  valueClass,
  sub,
  subClass,
}: {
  accent: string
  label: string
  value: string
  valueClass?: string
  sub: string
  subClass?: string
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-card p-4 shadow-sm">
      <span className={`absolute bottom-0 left-0 top-0 w-1 ${accent}`} />
      <div className="text-[11px] font-bold uppercase tracking-wide text-muted">
        {label}
      </div>
      <div
        className={`mt-1.5 font-mono text-2xl font-bold tracking-tight ${valueClass ?? 'text-foreground'}`}
      >
        {value}
      </div>
      <div className={`mt-0.5 text-xs font-semibold text-muted ${subClass ?? ''}`}>
        {sub}
      </div>
    </div>
  )
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string
  active: boolean
  dir: 1 | -1
  onClick: () => void
}) {
  return (
    <th className="px-4 py-3 font-bold">
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-foreground ${
          active ? 'text-foreground' : ''
        }`}
      >
        {label}
        {active ? (
          dir === 1 ? (
            <CaretUp size={11} weight="bold" />
          ) : (
            <CaretDown size={11} weight="bold" />
          )
        ) : null}
      </button>
    </th>
  )
}

function RowMenu({
  row,
  isTerminal,
}: {
  row: PawnListRow
  isTerminal: boolean
}) {
  const { t } = useI18n()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(
    null,
  )
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    function close() {
      setOpen(false)
    }
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  function toggle(e: React.MouseEvent) {
    e.stopPropagation()
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      setCoords({ top: rect.bottom + 6, right: window.innerWidth - rect.right })
    }
    setOpen((o) => !o)
  }

  function go(href: string) {
    setOpen(false)
    router.push(href)
  }

  function printTicket() {
    setOpen(false)
    window.open(`/api/print/loan/${row.id}`, '_blank', 'noopener,noreferrer')
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={t.pawn.list.rowActions}
        onClick={toggle}
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-muted hover:border-gold"
      >
        <DotsThree size={18} weight="bold" />
      </button>
      {open && coords
        ? createPortal(
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ top: coords.top, right: coords.right }}
              className="fixed z-50 min-w-[170px] rounded-xl border border-border bg-card p-1.5 shadow-lg"
            >
              <MenuItem
                label={t.pawn.list.viewTicket}
                onClick={() => go(`/pawn/${row.id}`)}
              />
              {!isTerminal ? (
                <>
                  <MenuItem
                    label={t.pawn.list.extendRenew}
                    onClick={() => go(`/pawn/${row.id}`)}
                  />
                  <MenuItem
                    label={t.pawn.list.redeem}
                    onClick={() => go(`/pawn/${row.id}`)}
                  />
                </>
              ) : null}
              <MenuItem label={t.pawn.list.printTicket} onClick={printTicket} />
              {!isTerminal ? (
                <MenuItem
                  label={t.pawn.list.markForfeited}
                  danger
                  onClick={() => go(`/pawn/${row.id}`)}
                />
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}

function MenuItem({
  label,
  onClick,
  danger,
}: {
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full rounded-lg px-3 py-2 text-left text-sm font-semibold hover:bg-background ${
        danger ? 'text-danger' : 'text-foreground'
      }`}
    >
      {label}
    </button>
  )
}

function Chip({
  label,
  count,
  active,
  tone,
  onClick,
}: {
  label: string
  count: number | null
  active: boolean
  tone?: 'error' | 'warning'
  onClick: () => void
}) {
  const base =
    'inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-bold transition-colors'
  const activeClass =
    tone === 'error'
      ? 'border-danger bg-danger text-white'
      : tone === 'warning'
      ? 'border-warning bg-warning text-white'
      : 'border-navy bg-navy text-white'
  const idleClass = 'border-border bg-card text-foreground hover:border-gold'
  const countClass = active
    ? 'bg-white/20 text-white'
    : 'bg-background text-muted'
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${base} ${active ? activeClass : idleClass}`}
    >
      {label}
      {count != null ? (
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${countClass}`}>
          {count}
        </span>
      ) : null}
    </button>
  )
}

function toNum(v: number | string): number {
  const n = typeof v === 'string' ? parseFloat(v) : v
  return isFinite(n) ? n : 0
}

function fmtMoney(v: number | string): string {
  const n = typeof v === 'string' ? parseFloat(v) : v
  if (!isFinite(n)) return '—'
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  })
}

function labelForStatus(
  s: LoanStatus,
  t: ReturnType<typeof useI18n>['t'],
): string {
  switch (s) {
    case 'active':
      return t.pawn.statusActive
    case 'extended':
      return t.pawn.statusExtended
    case 'partial_paid':
      return t.pawn.statusPartialPaid
    case 'redeemed':
      return t.pawn.statusRedeemed
    case 'forfeited':
      return t.pawn.statusForfeited
    case 'voided':
      return t.pawn.statusVoided
  }
}
