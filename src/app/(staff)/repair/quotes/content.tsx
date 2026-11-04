'use client'

import Link from 'next/link'
import { Plus, Sparkle } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { formatMoney } from '@/lib/format/money'
import { QuoteStatusBadge } from '@/components/custom-quotes/QuoteStatusBadge'
import type { CustomPieceCategory, CustomQuoteStatus } from '@/types/database-aliases'

export type QuoteListRow = {
  id: string
  quote_number: string
  status: CustomQuoteStatus
  category: CustomPieceCategory
  description: string
  customer_name: string
  price_total: number
  margin_pct: number
  expires_on: string | null
  created_at: string
}

const FILTERS: ReadonlyArray<{ key: string; status?: CustomQuoteStatus }> = [
  { key: 'open' },
  { key: 'all' },
  { key: 'draft', status: 'draft' },
  { key: 'sent', status: 'sent' },
  { key: 'accepted', status: 'accepted' },
  { key: 'converted', status: 'converted' },
  { key: 'expired', status: 'expired' },
  { key: 'declined', status: 'declined' },
  { key: 'voided', status: 'voided' },
]

export default function QuotesListContent({ rows, filter }: { rows: QuoteListRow[]; filter: string }) {
  const { t } = useI18n()
  const tq = t.quotes
  const filterLabel = (f: { key: string; status?: CustomQuoteStatus }) =>
    f.key === 'open' ? tq.list.filterOpen : f.key === 'all' ? tq.list.filterAll : tq.status[f.status!]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display flex items-center gap-2 text-2xl font-bold text-foreground">
            <Sparkle size={22} weight="bold" />
            {tq.title}
          </h1>
          <p className="mt-1 text-sm text-muted">{tq.subtitle}</p>
        </div>
        <Link
          href="/repair/quotes/new"
          className="inline-flex items-center gap-1 rounded-md bg-gold px-3 py-2 text-sm font-medium text-navy hover:bg-gold-2"
        >
          <Plus size={14} weight="bold" />
          {tq.new}
        </Link>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key === 'open' ? '/repair/quotes' : `/repair/quotes?status=${f.key}`}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              filter === f.key ? 'border-navy bg-navy text-white' : 'border-border text-foreground hover:bg-background'
            }`}
          >
            {filterLabel(f)}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted">
          {filter === 'open' || filter === 'all' ? tq.list.empty : tq.list.emptyForFilter}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted">
                <th className="px-3 py-2 font-semibold">{tq.list.number}</th>
                <th className="px-3 py-2 font-semibold">{tq.list.customer}</th>
                <th className="px-3 py-2 font-semibold">{tq.list.piece}</th>
                <th className="px-3 py-2 text-right font-semibold">{tq.list.total}</th>
                <th className="px-3 py-2 text-right font-semibold">{tq.list.margin}</th>
                <th className="px-3 py-2 font-semibold">{tq.list.status}</th>
                <th className="px-3 py-2 font-semibold">{tq.list.expires}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border/60 hover:bg-background">
                  <td className="px-3 py-2 font-mono">
                    <Link href={`/repair/quotes/${r.id}`} className="text-foreground hover:underline">
                      {r.quote_number}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-foreground">{r.customer_name}</td>
                  <td className="max-w-md px-3 py-2 text-foreground">
                    <span className="text-xs text-muted">{tq.categories[r.category]} · </span>
                    <span className="line-clamp-1">{r.description}</span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-foreground">{formatMoney(r.price_total)}</td>
                  <td className="px-3 py-2 text-right font-mono text-muted">{Math.round(r.margin_pct * 100)}%</td>
                  <td className="px-3 py-2">
                    <QuoteStatusBadge status={r.status} />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-muted">{r.expires_on ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
