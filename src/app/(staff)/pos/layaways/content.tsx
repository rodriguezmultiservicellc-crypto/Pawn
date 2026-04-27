'use client'

import Link from 'next/link'
import { ArrowLeft } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { LayawayStatusBadge } from '@/components/pos/Badges'
import type { LayawayStatus } from '@/types/database-aliases'

export type LayawayListRow = {
  id: string
  layaway_number: string
  customer_id: string
  customer_name: string
  status: LayawayStatus
  total_due: number
  paid_total: number
  balance_remaining: number
  first_payment_due: string | null
  final_due_date: string | null
  created_at: string
}

export default function LayawayListContent({
  rows,
  statusFilter,
  dueWindow,
  customerFilter,
}: {
  rows: LayawayListRow[]
  statusFilter: string
  dueWindow: string
  customerFilter: string
}) {
  const { t } = useI18n()

  const filterChips: Array<{ key: string; label: string; active: boolean }> = [
    {
      key: 'all',
      label: t.pos.layaway.filtersAll,
      active: statusFilter === 'all',
    },
    {
      key: 'active',
      label: t.pos.layaway.filtersActive,
      active: statusFilter === 'active',
    },
    {
      key: 'completed',
      label: t.pos.layaway.filtersCompleted,
      active: statusFilter === 'completed',
    },
    {
      key: 'cancelled',
      label: t.pos.layaway.filtersCancelled,
      active: statusFilter === 'cancelled',
    },
    {
      key: 'defaulted',
      label: t.pos.layaway.filtersDefaulted,
      active: statusFilter === 'defaulted',
    },
  ]

  function buildHref(opts: {
    status?: string
    due?: string
  }): string {
    const params = new URLSearchParams()
    if (opts.status && opts.status !== 'active')
      params.set('status', opts.status)
    if (opts.due && opts.due !== 'all') params.set('due', opts.due)
    if (customerFilter) params.set('customer', customerFilter)
    const qs = params.toString()
    return `/pos/layaways${qs ? `?${qs}` : ''}`
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Link
          href="/pos"
          className="inline-flex items-center gap-1 text-sm text-ash hover:text-ink"
        >
          <ArrowLeft size={14} weight="bold" />
          {t.pos.backToList}
        </Link>
        <h1 className="text-lg font-semibold text-ink">{t.pos.layaway.title}</h1>
      </div>

      <div className="flex flex-wrap gap-2">
        {filterChips.map((chip) => (
          <Link
            key={chip.key}
            href={buildHref({ status: chip.key, due: dueWindow })}
            className={`rounded-full border px-3 py-1 text-xs ${
              chip.active
                ? 'border-rausch bg-rausch text-canvas'
                : 'border-hairline bg-canvas text-ink hover:border-ink'
            }`}
          >
            {chip.label}
          </Link>
        ))}
        <Link
          href={buildHref({ status: statusFilter, due: 'dueSoon7' })}
          className={`rounded-full border px-3 py-1 text-xs ${
            dueWindow === 'dueSoon7'
              ? 'border-warning bg-warning/10 text-warning'
              : 'border-hairline bg-canvas text-ink hover:border-ink'
          }`}
        >
          {t.pos.layaway.filtersDueSoon}
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-hairline bg-cloud/40 p-12 text-center text-sm text-ash">
          {statusFilter === 'all' && dueWindow === 'all'
            ? t.pos.layaway.empty
            : t.pos.layaway.emptyForFilter}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-hairline bg-canvas">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-ash">
                <th className="px-3 py-2">{t.pos.layaway.layawayNumber}</th>
                <th className="px-3 py-2">{t.pos.sale.customer}</th>
                <th className="px-3 py-2 text-right">{t.pos.sale.total}</th>
                <th className="px-3 py-2 text-right">
                  {t.pos.layaway.paidTotal}
                </th>
                <th className="px-3 py-2 text-right">
                  {t.pos.layaway.balanceRemaining}
                </th>
                <th className="px-3 py-2">{t.pos.layaway.nextDue}</th>
                <th className="px-3 py-2">{t.repair.list.status}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-hairline/60">
                  <td className="px-3 py-2 font-mono text-xs text-ink">
                    <Link
                      href={`/pos/layaways/${r.id}`}
                      className="hover:underline"
                    >
                      {r.layaway_number}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-ink">
                    <Link
                      href={`/customers/${r.customer_id}`}
                      className="hover:underline"
                    >
                      {r.customer_name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-ink">
                    {fmtMoney(r.total_due)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-ink">
                    {fmtMoney(r.paid_total)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-ink">
                    {fmtMoney(r.balance_remaining)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-ash">
                    {r.first_payment_due ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    <LayawayStatusBadge status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
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
