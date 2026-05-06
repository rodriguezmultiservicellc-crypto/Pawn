'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { MagnifyingGlass, Plus, Coins } from '@phosphor-icons/react'
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
}

export type Counts = {
  active: number
  overdue: number
  dueSoon7: number
  redeemed: number
  forfeited: number
  voided: number
}

const STATUS_BADGE: Record<LoanStatus, { bg: string; text: string }> = {
  active: { bg: 'bg-success/10 border-success/30', text: 'text-success' },
  extended: { bg: 'bg-success/10 border-success/30', text: 'text-success' },
  partial_paid: { bg: 'bg-warning/10 border-warning/30', text: 'text-warning' },
  redeemed: { bg: 'bg-background border-border', text: 'text-muted' },
  forfeited: { bg: 'bg-background border-border', text: 'text-muted' },
  voided: { bg: 'bg-background border-border', text: 'text-muted' },
}

export default function PawnContent({
  rows,
  query,
  statusFilter,
  dueWindow,
  customerFilter,
  counts,
  today,
}: {
  rows: PawnListRow[]
  query: string
  statusFilter: string
  dueWindow: string
  customerFilter: string
  counts: Counts
  today: string
}) {
  const { t } = useI18n()
  const router = useRouter()
  const sp = useSearchParams()
  const [searchInput, setSearchInput] = useState(query)
  const [pending, startTransition] = useTransition()

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

  const hasFilter =
    !!query ||
    statusFilter !== 'active' ||
    dueWindow !== 'all' ||
    !!customerFilter

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t.pawn.title}</h1>
        <Link
          href="/pawn/new"
          className="inline-flex items-center gap-1 rounded-md bg-gold px-4 py-2 text-navy font-medium hover:bg-gold-2"
        >
          <Plus size={16} weight="bold" />
          <span>{t.pawn.new}</span>
        </Link>
      </div>

      {/* Status chips */}
      <div className="flex flex-wrap gap-2">
        <Chip
          label={t.pawn.list.filterActive}
          count={counts.active}
          active={statusFilter === 'active'}
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
        <form
          onSubmit={onSearchSubmit}
          className="sm:col-span-7 flex items-center gap-2"
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
              className="block w-full rounded-md border border-border bg-card py-2 pl-9 pr-3 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
            />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground hover:border-foreground disabled:opacity-50"
          >
            {t.common.search}
          </button>
        </form>

        <select
          value={dueWindow}
          onChange={(e) => pushParams({ due: e.target.value })}
          className="sm:col-span-4 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
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
              pushParams({
                q: null,
                status: null,
                due: null,
                customer: null,
              })
            }}
            className="sm:col-span-1 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground hover:border-foreground"
          >
            {t.common.clear}
          </button>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-12 text-center">
          <Coins size={32} weight="light" className="mx-auto mb-3 text-muted" />
          <p className="text-muted">
            {hasFilter ? t.pawn.list.emptyForFilter : t.pawn.list.empty}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">{t.pawn.list.ticket}</th>
                <th className="px-4 py-3 font-medium">{t.pawn.list.customer}</th>
                <th className="px-4 py-3 font-medium">{t.pawn.list.principal}</th>
                <th className="px-4 py-3 font-medium">{t.pawn.list.dueDate}</th>
                <th className="px-4 py-3 font-medium">{t.pawn.list.daysToDue}</th>
                <th className="px-4 py-3 font-medium">{t.pawn.list.status}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const badge = STATUS_BADGE[r.status]
                const days = daysBetween(today, r.due_date)
                const isTerminal =
                  r.status === 'redeemed' ||
                  r.status === 'forfeited' ||
                  r.status === 'voided'
                const isOverdue = !isTerminal && days < 0
                const isDueSoon = !isTerminal && days >= 0 && days <= 7
                return (
                  <tr
                    key={r.id}
                    className="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-background"
                    onClick={() => router.push(`/pawn/${r.id}`)}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-foreground">
                      {r.ticket_number}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">
                        {r.customer_name}
                      </div>
                      {r.customer_phone ? (
                        <div className="text-xs text-muted">
                          {r.customer_phone}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-foreground">
                      {fmtMoney(r.principal)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-foreground">
                      {r.due_date}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {isTerminal ? (
                        <span className="text-muted">—</span>
                      ) : isOverdue ? (
                        <span className="text-danger">
                          {t.pawn.list.daysOverdue}: {Math.abs(days)}
                        </span>
                      ) : isDueSoon ? (
                        <span className="text-warning">{days}</span>
                      ) : (
                        <span className="text-foreground">{days}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${badge.bg} ${badge.text}`}
                      >
                        {labelForStatus(r.status, t)}
                      </span>
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
    'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors'
  const toneBg =
    tone === 'error'
      ? 'border-danger/30 text-danger hover:bg-danger/5'
      : tone === 'warning'
      ? 'border-warning/30 text-warning hover:bg-warning/5'
      : 'border-border text-foreground hover:bg-background'
  const activeRing = active ? 'ring-2 ring-ink/20 bg-background' : 'bg-card'
  return (
    <button type="button" onClick={onClick} className={`${base} ${toneBg} ${activeRing}`}>
      {label}
      {count != null ? (
        <span className="rounded-full bg-card/60 px-1.5 py-0.5 text-[10px] font-mono text-muted">
          {count}
        </span>
      ) : null}
    </button>
  )
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
