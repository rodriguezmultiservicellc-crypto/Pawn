'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Kanban,
  MagnifyingGlass,
  Plus,
  Wrench,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { daysBetween } from '@/lib/pawn/math'
import { ServiceTypeBadge } from '@/components/repair/ServiceTypeBadge'
import { StatusBadge } from '@/components/repair/StatusBadge'
import type {
  RepairStatus,
  ServiceType,
} from '@/types/database-aliases'

export type RepairListRow = {
  id: string
  ticket_number: string
  customer_id: string
  customer_name: string
  customer_phone: string | null
  service_type: ServiceType
  title: string
  promised_date: string | null
  status: RepairStatus
  quote_amount: number | null
  balance_due: number | null
  assigned_to: string | null
  assigned_to_name: string | null
  is_locked: boolean
  created_at: string
}

export type Counts = {
  active: number
  overdue: number
  dueSoon7: number
  ready: number
  pickedUp: number
  abandoned: number
  voided: number
}

export default function RepairContent({
  rows,
  query,
  statusFilter,
  dueWindow,
  customerFilter,
  serviceTypeFilter,
  assignedToFilter,
  counts,
  today,
  isManager,
}: {
  rows: RepairListRow[]
  query: string
  statusFilter: string
  dueWindow: string
  customerFilter: string
  serviceTypeFilter: string
  assignedToFilter: string
  counts: Counts
  today: string
  isManager: boolean
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
      router.push(`/repair${usp.toString() ? `?${usp.toString()}` : ''}`)
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
    !!customerFilter ||
    !!serviceTypeFilter ||
    !!assignedToFilter

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">{t.repair.title}</h1>
          <p className="text-sm text-muted">{t.repair.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {isManager ? (
            <Link
              href="/repair/board"
              className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:border-foreground"
            >
              <Kanban size={16} weight="bold" />
              <span>{t.repair.list.openBoard}</span>
            </Link>
          ) : null}
          <Link
            href="/repair/new"
            className="inline-flex items-center gap-1 rounded-md bg-gold px-4 py-2 text-navy font-medium hover:bg-gold-2"
          >
            <Plus size={16} weight="bold" />
            <span>{t.repair.new}</span>
          </Link>
        </div>
      </div>

      {/* Status chips */}
      <div className="flex flex-wrap gap-2">
        <Chip
          label={t.repair.list.filterInProgress}
          count={counts.active}
          active={statusFilter === 'active'}
          onClick={() => pushParams({ status: 'active', due: null })}
        />
        <Chip
          label={t.repair.list.filterOverdue}
          count={counts.overdue}
          active={dueWindow === 'overdue'}
          tone="error"
          onClick={() => pushParams({ status: 'active', due: 'overdue' })}
        />
        <Chip
          label={t.repair.list.filterDueSoon}
          count={counts.dueSoon7}
          active={dueWindow === 'dueSoon7'}
          tone="warning"
          onClick={() => pushParams({ status: 'active', due: 'dueSoon7' })}
        />
        <Chip
          label={t.repair.list.filterReady}
          count={counts.ready}
          active={statusFilter === 'ready'}
          tone="success"
          onClick={() => pushParams({ status: 'ready', due: null })}
        />
        <Chip
          label={t.repair.list.filterPickedUp}
          count={counts.pickedUp}
          active={statusFilter === 'picked_up'}
          onClick={() => pushParams({ status: 'picked_up', due: null })}
        />
        <Chip
          label={t.repair.list.filterAbandoned}
          count={counts.abandoned}
          active={statusFilter === 'abandoned'}
          tone="error"
          onClick={() => pushParams({ status: 'abandoned', due: null })}
        />
        <Chip
          label={t.repair.list.filterVoided}
          count={counts.voided}
          active={statusFilter === 'voided'}
          onClick={() => pushParams({ status: 'voided', due: null })}
        />
        <Chip
          label={t.repair.list.filterAll}
          count={null}
          active={statusFilter === 'all'}
          onClick={() => pushParams({ status: 'all', due: null })}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
        <form
          onSubmit={onSearchSubmit}
          className="sm:col-span-6 flex items-center gap-2"
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
              placeholder={t.repair.list.searchPlaceholder}
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
          value={serviceTypeFilter}
          onChange={(e) => pushParams({ serviceType: e.target.value })}
          className="sm:col-span-3 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
        >
          <option value="">{t.common.all}</option>
          <option value="repair">{t.repair.serviceTypes.repair}</option>
          <option value="stone_setting">{t.repair.serviceTypes.stoneSetting}</option>
          <option value="sizing">{t.repair.serviceTypes.sizing}</option>
          <option value="restring">{t.repair.serviceTypes.restring}</option>
          <option value="plating">{t.repair.serviceTypes.plating}</option>
          <option value="engraving">{t.repair.serviceTypes.engraving}</option>
          <option value="custom">{t.repair.serviceTypes.custom}</option>
        </select>

        <select
          value={dueWindow}
          onChange={(e) => pushParams({ due: e.target.value })}
          className="sm:col-span-2 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
        >
          <option value="all">{t.repair.list.dueWindowAll}</option>
          <option value="overdue">{t.repair.list.dueWindowOverdue}</option>
          <option value="dueSoon7">{t.repair.list.dueWindowDueSoon7}</option>
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
                serviceType: null,
                assignedTo: null,
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
          <Wrench size={32} weight="light" className="mx-auto mb-3 text-muted" />
          <p className="text-muted">
            {hasFilter ? t.repair.list.emptyForFilter : t.repair.list.empty}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">{t.repair.list.ticket}</th>
                <th className="px-4 py-3 font-medium">
                  {t.repair.list.customer}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t.repair.list.serviceType}
                </th>
                <th className="px-4 py-3 font-medium">{t.repair.list.title}</th>
                <th className="px-4 py-3 font-medium">
                  {t.repair.list.promised}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t.repair.list.assignedTo}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t.repair.list.balance}
                </th>
                <th className="px-4 py-3 font-medium">{t.repair.list.status}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const days =
                  r.promised_date != null ? daysBetween(today, r.promised_date) : null
                const isTerminal =
                  r.status === 'picked_up' ||
                  r.status === 'abandoned' ||
                  r.status === 'voided'
                const isOverdue =
                  !isTerminal && days != null && days < 0
                const isDueSoon =
                  !isTerminal && days != null && days >= 0 && days <= 7
                return (
                  <tr
                    key={r.id}
                    className="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-background"
                    onClick={() => router.push(`/repair/${r.id}`)}
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
                    <td className="px-4 py-3">
                      <ServiceTypeBadge type={r.service_type} />
                    </td>
                    <td className="px-4 py-3 text-foreground">
                      <span className="line-clamp-1">{r.title}</span>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {r.promised_date ? (
                        <div className="font-mono text-foreground">
                          {r.promised_date}
                        </div>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                      {!isTerminal && days != null ? (
                        isOverdue ? (
                          <div className="text-danger">
                            {t.pawn.list.daysOverdue}: {Math.abs(days)}
                          </div>
                        ) : isDueSoon ? (
                          <div className="text-warning">
                            {days}d
                          </div>
                        ) : null
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-xs text-foreground">
                      {r.assigned_to_name ?? '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-foreground">
                      {r.balance_due == null
                        ? '—'
                        : fmtMoney(r.balance_due)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={r.status} />
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
  tone?: 'error' | 'warning' | 'success'
  onClick: () => void
}) {
  const base =
    'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors'
  const toneBg =
    tone === 'error'
      ? 'border-danger/30 text-danger hover:bg-danger/5'
      : tone === 'warning'
      ? 'border-warning/30 text-warning hover:bg-warning/5'
      : tone === 'success'
      ? 'border-success/30 text-success hover:bg-success/5'
      : 'border-border text-foreground hover:bg-background'
  const activeRing = active ? 'ring-2 ring-ink/20 bg-background' : 'bg-card'
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${base} ${toneBg} ${activeRing}`}
    >
      {label}
      {count != null ? (
        <span className="rounded-full bg-card/60 px-1.5 py-0.5 text-[10px] font-mono text-muted">
          {count}
        </span>
      ) : null}
    </button>
  )
}

function fmtMoney(v: number): string {
  if (!isFinite(v)) return '—'
  return v.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  })
}
