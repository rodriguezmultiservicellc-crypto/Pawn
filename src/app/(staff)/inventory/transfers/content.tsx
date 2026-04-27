'use client'

import { useTransition } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowLeft,
  ArrowRight,
  ArrowsLeftRight,
  Plus,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import type { TransferStatus } from '@/types/database-aliases'

export type TransferDirection = 'incoming' | 'outgoing'

export type TransferListRow = {
  id: string
  direction: TransferDirection
  from_tenant_id: string
  to_tenant_id: string
  from_shop_label: string
  to_shop_label: string
  status: TransferStatus
  item_count: number
  total_value: number
  requested_at: string | null
  requested_by_label: string | null
}

type TransferStatusFilter =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'cancelled'
  | ''
type TransferDirectionFilter = 'incoming' | 'outgoing' | ''

const STATUS_BADGE: Record<
  TransferStatus,
  { bg: string; text: string }
> = {
  pending: { bg: 'bg-warning/10 border-warning/30', text: 'text-warning' },
  accepted: { bg: 'bg-success/10 border-success/30', text: 'text-success' },
  rejected: { bg: 'bg-error/10 border-error/30', text: 'text-error' },
  cancelled: { bg: 'bg-cloud border-hairline', text: 'text-ash' },
  // Legacy values from 0003 — never written by the v1 UI but visible
  // if older rows are still around.
  in_transit: { bg: 'bg-cloud border-hairline', text: 'text-ash' },
  received: { bg: 'bg-cloud border-hairline', text: 'text-ash' },
}

export default function TransfersContent({
  transfers,
  statusFilter,
  directionFilter,
  statusCounts,
}: {
  transfers: TransferListRow[]
  statusFilter: TransferStatusFilter
  directionFilter: TransferDirectionFilter
  statusCounts: Record<string, number>
  /** Reserved for future cross-shop deep-linking. */
  activeTenantId: string
}) {
  const { t } = useI18n()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  function pushParams(next: Record<string, string | null>) {
    const sp = new URLSearchParams(searchParams.toString())
    for (const [k, v] of Object.entries(next)) {
      if (v == null || v === '') sp.delete(k)
      else sp.set(k, v)
    }
    startTransition(() => {
      router.push(
        `/inventory/transfers${sp.toString() ? `?${sp.toString()}` : ''}`,
      )
    })
  }

  const hasFilter = !!statusFilter || !!directionFilter

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ArrowsLeftRight size={22} weight="regular" className="text-ash" />
            <h1 className="text-2xl font-bold">{t.inventory.transfers.list.title}</h1>
          </div>
          <p className="mt-1 text-sm text-ash">
            {t.inventory.transfers.list.subtitle}
          </p>
        </div>
        <Link
          href="/inventory/transfers/new"
          className="inline-flex items-center gap-1 rounded-md bg-rausch px-4 py-2 text-canvas font-medium hover:bg-rausch-deep"
        >
          <Plus size={16} weight="bold" />
          <span>{t.inventory.transfers.list.new}</span>
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FilterChip
          label={`${t.inventory.transfers.filters.all} (${statusCounts.all ?? 0})`}
          active={!statusFilter}
          onClick={() => pushParams({ status: null })}
          disabled={pending}
        />
        <FilterChip
          label={`${t.inventory.transfers.filters.pending} (${statusCounts.pending ?? 0})`}
          active={statusFilter === 'pending'}
          onClick={() => pushParams({ status: 'pending' })}
          disabled={pending}
          tone="warning"
        />
        <FilterChip
          label={`${t.inventory.transfers.filters.accepted} (${statusCounts.accepted ?? 0})`}
          active={statusFilter === 'accepted'}
          onClick={() => pushParams({ status: 'accepted' })}
          disabled={pending}
          tone="success"
        />
        <FilterChip
          label={`${t.inventory.transfers.filters.rejected} (${statusCounts.rejected ?? 0})`}
          active={statusFilter === 'rejected'}
          onClick={() => pushParams({ status: 'rejected' })}
          disabled={pending}
          tone="error"
        />
        <FilterChip
          label={`${t.inventory.transfers.filters.cancelled} (${statusCounts.cancelled ?? 0})`}
          active={statusFilter === 'cancelled'}
          onClick={() => pushParams({ status: 'cancelled' })}
          disabled={pending}
        />

        <span className="mx-2 h-5 w-px bg-hairline" />

        <select
          value={directionFilter}
          onChange={(e) => pushParams({ direction: e.target.value })}
          disabled={pending}
          className="rounded-md border border-hairline bg-canvas px-3 py-1.5 text-sm text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
        >
          <option value="">{t.inventory.transfers.filters.directionAll}</option>
          <option value="incoming">
            {t.inventory.transfers.filters.directionIncoming}
          </option>
          <option value="outgoing">
            {t.inventory.transfers.filters.directionOutgoing}
          </option>
        </select>

        {hasFilter ? (
          <button
            type="button"
            onClick={() => pushParams({ status: null, direction: null })}
            className="ml-auto rounded-md border border-hairline bg-canvas px-3 py-1.5 text-sm text-ink hover:border-ink"
          >
            {t.common.clear}
          </button>
        ) : null}
      </div>

      {transfers.length === 0 ? (
        <div className="rounded-lg border border-hairline bg-canvas p-12 text-center">
          <p className="text-ash">
            {hasFilter
              ? t.inventory.transfers.list.emptyForFilter
              : t.inventory.transfers.list.empty}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-hairline bg-canvas">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-hairline text-ash">
              <tr>
                <th className="w-12 px-3 py-3" aria-label="direction" />
                <th className="px-4 py-3 font-medium">
                  {t.inventory.transfers.list.fromShopColumn}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t.inventory.transfers.list.toShopColumn}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t.inventory.transfers.list.itemsColumn}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t.inventory.transfers.list.totalValueColumn}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t.inventory.transfers.list.statusColumn}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t.inventory.transfers.list.requestedAtColumn}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t.inventory.transfers.list.requestedByColumn}
                </th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((row) => {
                const badge = STATUS_BADGE[row.status]
                return (
                  <tr
                    key={row.id}
                    className="cursor-pointer border-b border-hairline transition-colors last:border-0 hover:bg-cloud"
                    onClick={() =>
                      router.push(`/inventory/transfers/${row.id}`)
                    }
                  >
                    <td className="px-3 py-2 text-center">
                      {row.direction === 'outgoing' ? (
                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-cloud text-ash">
                          <ArrowRight size={14} weight="bold" />
                        </span>
                      ) : (
                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-cloud text-ash">
                          <ArrowLeft size={14} weight="bold" />
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-ink">{row.from_shop_label}</td>
                    <td className="px-4 py-3 text-ink">{row.to_shop_label}</td>
                    <td className="px-4 py-3 font-mono text-xs text-ink">
                      {row.item_count}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-ink">
                      {row.total_value > 0
                        ? formatMoney(row.total_value)
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${badge.bg} ${badge.text}`}
                      >
                        {labelForStatus(row.status, t)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-ash">
                      {row.requested_at
                        ? formatRelative(row.requested_at)
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-ash">
                      {row.requested_by_label ?? '—'}
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

function FilterChip({
  label,
  active,
  onClick,
  disabled,
  tone,
}: {
  label: string
  active: boolean
  onClick: () => void
  disabled?: boolean
  tone?: 'success' | 'warning' | 'error'
}) {
  const toneClass = active
    ? tone === 'success'
      ? 'bg-success/10 border-success/40 text-success'
      : tone === 'warning'
      ? 'bg-warning/10 border-warning/40 text-warning'
      : tone === 'error'
      ? 'bg-error/10 border-error/40 text-error'
      : 'bg-ink text-canvas border-ink'
    : 'border-hairline bg-canvas text-ink hover:border-ink'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${toneClass}`}
    >
      {label}
    </button>
  )
}

function formatMoney(v: number): string {
  if (!isFinite(v)) return '—'
  return v.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  })
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  if (!isFinite(then)) return iso
  const diffMs = Date.now() - then
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return `${diffSec}s`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d`
  return new Date(iso).toLocaleDateString()
}

function labelForStatus(
  s: TransferStatus,
  t: ReturnType<typeof useI18n>['t'],
): string {
  switch (s) {
    case 'pending':
      return t.inventory.transfers.statusBadges.pending
    case 'accepted':
      return t.inventory.transfers.statusBadges.accepted
    case 'rejected':
      return t.inventory.transfers.statusBadges.rejected
    case 'cancelled':
      return t.inventory.transfers.statusBadges.cancelled
    default:
      return s
  }
}
