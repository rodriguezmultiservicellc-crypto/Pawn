'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { HandCoins, MagnifyingGlass, Plus } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { formatMoney, shortDateTime } from '@/lib/format/money'

export type BuyListRow = {
  /** The buy's page: /buy/<id> (its first item's inventory id). */
  id: string
  /** BT-###### (patches/0115); an older buy has none. */
  ticketNumber: string | null
  occurredAt: string
  customerName: string
  itemCount: number
  firstItem: string
  paid: number
}

export default function BuyListContent({
  rows,
  query,
  page,
  hasOlder,
}: {
  rows: BuyListRow[]
  query: string
  page: number
  hasOlder: boolean
}) {
  const { t } = useI18n()
  const l = t.buy.list
  const router = useRouter()
  const [search, setSearch] = useState(query)

  function href(next: { q?: string; page?: number }): string {
    const usp = new URLSearchParams()
    const q = next.q ?? query
    const p = next.page ?? 1
    if (q) usp.set('q', q)
    if (p > 1) usp.set('page', String(p))
    const s = usp.toString()
    return `/buy${s ? `?${s}` : ''}`
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">{l.title}</h1>
          <p className="text-sm text-muted">{l.subtitle}</p>
        </div>
        <Link
          href="/buy/new"
          className="inline-flex items-center gap-1 rounded-xl bg-gold px-4 py-2 font-bold text-navy transition-all hover:-translate-y-0.5 hover:bg-gold-2 hover:shadow-lg"
        >
          <Plus size={16} weight="bold" />
          <span>{t.buy.buyReceipt.newBuy}</span>
        </Link>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          router.push(href({ q: search.trim(), page: 1 }))
        }}
        className="flex max-w-xl items-center gap-2"
      >
        <div className="relative flex-1">
          <MagnifyingGlass
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={l.searchPlaceholder}
            className="block w-full rounded-xl border border-border bg-card py-2 pl-9 pr-3 text-sm text-foreground focus:border-blue focus:outline-none"
          />
        </div>
        <button
          type="submit"
          className="rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-background"
        >
          {t.common.search}
        </button>
        {query ? (
          <Link
            href="/buy"
            onClick={() => setSearch('')}
            className="rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-background"
          >
            {t.common.clear}
          </Link>
        ) : null}
      </form>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <HandCoins size={32} weight="light" className="mx-auto mb-3 text-muted" />
          <p className="text-muted">{query ? l.emptyForFilter : l.empty}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">{l.number}</th>
                <th className="px-4 py-3 font-medium">{l.date}</th>
                <th className="px-4 py-3 font-medium">{l.customer}</th>
                <th className="px-4 py-3 font-medium">{l.items}</th>
                <th className="px-4 py-3 text-right font-medium">{l.paid}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-background"
                  onClick={() => router.push(`/buy/${r.id}`)}
                >
                  <td className="px-4 py-3 font-mono text-xs">
                    <Link href={`/buy/${r.id}`} className="text-blue hover:underline">
                      {r.ticketNumber ?? '—'}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-foreground">
                    {shortDateTime(r.occurredAt)}
                  </td>
                  <td className="px-4 py-3 font-medium text-foreground">{r.customerName}</td>
                  <td className="px-4 py-3 text-foreground">
                    <span className="line-clamp-1">
                      {r.firstItem}
                      {r.itemCount > 1 ? (
                        <span className="ml-1 text-xs text-muted">
                          {l.moreItems.replace('{count}', String(r.itemCount - 1))}
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-foreground">
                    {formatMoney(r.paid)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {page > 1 || hasOlder ? (
        <div className="flex justify-between">
          {page > 1 ? (
            <Link
              href={href({ page: page - 1 })}
              className="rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-background"
            >
              {l.newer}
            </Link>
          ) : (
            <span />
          )}
          {hasOlder ? (
            <Link
              href={href({ page: page + 1 })}
              className="rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-background"
            >
              {l.older}
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
