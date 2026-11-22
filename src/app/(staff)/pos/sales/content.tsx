'use client'

import Link from 'next/link'
import { ArrowLeft, MagnifyingGlass, Plus, X } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { SaleStatusBadge } from '@/components/pos/Badges'
import { formatMoney, formatNumber, shortDateTime } from '@/lib/format/money'
import type { SaleKind, SaleStatus } from '@/types/database-aliases'

export type SaleHistoryRow = {
  id: string
  sale_number: string
  sale_kind: SaleKind
  status: SaleStatus
  total: number
  paid_total: number
  /** completed_at, or created_at for a sale still open. */
  at: string
  customer_id: string | null
  customer_name: string | null
}

type Filters = {
  status: SaleStatus | null
  kind: SaleKind | null
  customer: string | null
  from: string | null
  to: string | null
  q: string
}

const INPUT =
  'rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-blue'

export default function SaleHistoryContent({
  rows,
  total,
  page,
  pageSize,
  filters,
  customerName,
}: {
  rows: SaleHistoryRow[]
  total: number
  page: number
  pageSize: number
  filters: Filters
  customerName: string | null
}) {
  const { t } = useI18n()
  const th = t.pos.history

  function href(over: Partial<Filters> & { page?: number }): string {
    const f = { ...filters, ...over }
    const sp = new URLSearchParams()
    if (f.status) sp.set('status', f.status)
    if (f.kind) sp.set('kind', f.kind)
    if (f.customer) sp.set('customer', f.customer)
    if (f.from) sp.set('from', f.from)
    if (f.to) sp.set('to', f.to)
    if (f.q) sp.set('q', f.q)
    if (over.page && over.page > 1) sp.set('page', String(over.page))
    const qs = sp.toString()
    return `/pos/sales${qs ? `?${qs}` : ''}`
  }

  const first = total === 0 ? 0 : (page - 1) * pageSize + 1
  const last = Math.min(page * pageSize, total)
  const hasFilters = !!(filters.status || filters.kind || filters.from || filters.to || filters.q)
  const kindLabel: Record<SaleKind, string> = {
    retail: th.kinds.retail,
    layaway: th.kinds.layaway,
    metal: th.kinds.metal,
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link href="/pos" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
          <ArrowLeft size={14} weight="bold" />
          {t.pos.backToList}
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold">{th.title}</h1>
        <Link
          href="/pos/sales/new"
          className="inline-flex items-center gap-1 rounded-xl bg-gold px-4 py-2 font-bold text-navy transition-all hover:-translate-y-0.5 hover:bg-gold-2 hover:shadow-lg"
        >
          <Plus size={16} weight="bold" />
          {t.nav.newSale}
        </Link>
      </div>

      {/* Plain GET form: the URL is the state, so a filtered view can be
          bookmarked or shared and the back button works. */}
      <form action="/pos/sales" method="get" className="flex flex-wrap items-end gap-2">
        {filters.customer ? <input type="hidden" name="customer" value={filters.customer} /> : null}
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted">{th.saleNumber}</span>
          <span className="relative">
            <MagnifyingGlass size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input name="q" defaultValue={filters.q} placeholder="S-000123" className={`${INPUT} w-40 pl-8`} />
          </span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted">{th.status}</span>
          <select name="status" defaultValue={filters.status ?? ''} className={INPUT}>
            <option value="">{th.all}</option>
            <option value="completed">{th.statuses.completed}</option>
            <option value="open">{th.statuses.open}</option>
            <option value="voided">{th.statuses.voided}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted">{th.kind}</span>
          <select name="kind" defaultValue={filters.kind ?? ''} className={INPUT}>
            <option value="">{th.all}</option>
            <option value="retail">{th.kinds.retail}</option>
            <option value="layaway">{th.kinds.layaway}</option>
            <option value="metal">{th.kinds.metal}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted">{th.from}</span>
          <input type="date" name="from" defaultValue={filters.from ?? ''} className={INPUT} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted">{th.to}</span>
          <input type="date" name="to" defaultValue={filters.to ?? ''} className={INPUT} />
        </label>
        <button type="submit" className="rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold hover:border-blue">
          {th.apply}
        </button>
        {hasFilters ? (
          <Link
            href={href({ status: null, kind: null, from: null, to: null, q: '' })}
            className="px-2 py-2 text-sm text-blue hover:underline"
          >
            {th.clear}
          </Link>
        ) : null}
      </form>

      {filters.customer ? (
        <div className="inline-flex items-center gap-2 rounded-full border border-info/30 bg-info/5 px-3 py-1 text-sm text-info">
          {th.forCustomer.replace('{name}', customerName ?? '—')}
          <Link href={href({ customer: null })} aria-label={th.clear} className="hover:text-foreground">
            <X size={12} weight="bold" />
          </Link>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-background/40 p-12 text-center text-sm text-muted">
          {hasFilters || filters.customer ? th.emptyForFilter : th.empty}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-3 py-2">{th.saleNumber}</th>
                <th className="px-3 py-2">{th.date}</th>
                <th className="px-3 py-2">{t.pos.sale.customer}</th>
                <th className="px-3 py-2">{th.kind}</th>
                <th className="px-3 py-2 text-right">{t.pos.sale.total}</th>
                <th className="px-3 py-2 text-right">{th.paid}</th>
                <th className="px-3 py-2">{th.status}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border/60 hover:bg-background">
                  <td className="px-3 py-2 font-mono text-xs">
                    <Link href={`/pos/sales/${r.id}`} className="text-blue hover:underline">
                      {r.sale_number || '—'}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">{shortDateTime(r.at)}</td>
                  <td className="px-3 py-2">
                    {r.customer_id && r.customer_name ? (
                      <Link href={`/customers/${r.customer_id}`} className="hover:underline">
                        {r.customer_name}
                      </Link>
                    ) : (
                      <span className="text-muted">{t.pos.sale.anonymous}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary">{kindLabel[r.sale_kind]}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatMoney(r.total)}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatMoney(r.paid_total)}</td>
                  <td className="px-3 py-2">
                    <SaleStatusBadge status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
          <span>
            {th.showing
              .replace('{first}', formatNumber(first))
              .replace('{last}', formatNumber(last))
              .replace('{total}', formatNumber(total))}
          </span>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link href={href({ page: page - 1 })} className="rounded-xl border border-border bg-card px-3 py-1.5 font-semibold text-foreground hover:border-blue">
                {th.prev}
              </Link>
            ) : null}
            {last < total ? (
              <Link href={href({ page: page + 1 })} className="rounded-xl border border-border bg-card px-3 py-1.5 font-semibold text-foreground hover:border-blue">
                {th.next}
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
