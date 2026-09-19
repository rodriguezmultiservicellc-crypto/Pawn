'use client'

import Link from 'next/link'
import { HandCoins, Plus } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { formatMoney } from '@/lib/format/money'
import type { ConsignorStatus } from '@/types/database-aliases'

export type ConsignorListRow = {
  id: string
  consignor_number: string
  name: string
  customer_id: string | null
  commission_pct: number
  status: ConsignorStatus
  items_on_floor: number
  balance: number
}

function pct(fraction: number): string {
  return `${(Math.round(fraction * 10000) / 100).toFixed(2).replace(/\.?0+$/, '')}%`
}

export default function ConsignorsContent({
  consignors,
  enabled,
  canManage,
}: {
  consignors: ConsignorListRow[]
  enabled: boolean
  canManage: boolean
}) {
  const { t } = useI18n()
  const tc = t.consignment

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <HandCoins size={22} weight="regular" className="text-muted" />
            <h1 className="font-display text-2xl font-bold">{tc.title}</h1>
          </div>
          <p className="mt-1 text-sm text-muted">{tc.subtitle}</p>
        </div>
        {canManage && enabled ? (
          <Link
            href="/consignors/new"
            className="inline-flex items-center gap-1 rounded-md bg-gold px-4 py-2 font-medium text-navy hover:bg-gold-2"
          >
            <Plus size={16} weight="bold" />
            <span>{tc.list.newConsignor}</span>
          </Link>
        ) : null}
      </div>

      {!enabled ? (
        <div className="rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-foreground">
          {tc.disabled}{' '}
          <Link href="/settings/consignment" className="text-blue underline">
            {tc.enableHint}
          </Link>
        </div>
      ) : null}

      {consignors.length === 0 ? (
        <div className="rounded-xl border border-border bg-card px-4 py-12 text-center">
          <p className="text-sm text-foreground">{tc.list.empty}</p>
          <p className="mt-1 text-sm text-muted">{tc.list.emptyHint}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2">{tc.list.colNumber}</th>
                <th className="px-3 py-2">{tc.list.colName}</th>
                <th className="px-3 py-2 text-right">
                  {tc.list.colCommission}
                </th>
                <th className="px-3 py-2 text-right">{tc.list.colItems}</th>
                <th className="px-3 py-2 text-right">{tc.list.colBalance}</th>
                <th className="px-3 py-2">{tc.list.colStatus}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {consignors.map((c) => (
                <tr key={c.id} className="hover:bg-background/60">
                  <td className="px-3 py-2 font-mono">
                    <Link
                      href={`/consignors/${c.id}`}
                      className="text-blue hover:underline"
                    >
                      {c.consignor_number}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-foreground">{c.name}</td>
                  <td className="px-3 py-2 text-right font-mono text-foreground">
                    {pct(c.commission_pct)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-foreground">
                    {c.items_on_floor}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-mono ${
                      c.balance < 0 ? 'text-warning' : 'text-foreground'
                    }`}
                  >
                    {formatMoney(Math.abs(c.balance))}
                    {c.balance < 0 ? (
                      <span className="ml-1 text-xs">
                        ({tc.list.owesShop})
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs ${
                        c.status === 'active'
                          ? 'border-success/30 bg-success/10 text-success'
                          : 'border-border bg-background text-muted'
                      }`}
                    >
                      {c.status === 'active'
                        ? tc.list.statusActive
                        : tc.list.statusInactive}
                    </span>
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
