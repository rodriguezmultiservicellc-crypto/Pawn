'use client'

import { useState, useTransition } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { MagnifyingGlass, Plus, Image as ImageIcon } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import type {
  InventoryCategory,
  InventorySource,
  InventoryStatus,
} from '@/types/database-aliases'

export type InventoryListRow = {
  id: string
  sku: string
  description: string
  category: InventoryCategory
  brand: string | null
  model: string | null
  serial_number: string | null
  source: InventorySource
  status: InventoryStatus
  list_price: number | string | null
  sale_price: number | string | null
  created_at: string
  thumb_url: string | null
}

const STATUS_BADGE: Record<InventoryStatus, { bg: string; text: string }> = {
  available: { bg: 'bg-success/10 border-success/30', text: 'text-success' },
  held: { bg: 'bg-warning/10 border-warning/30', text: 'text-warning' },
  sold: { bg: 'bg-background border-border', text: 'text-muted' },
  scrapped: { bg: 'bg-background border-border', text: 'text-muted' },
  // 'transferred' rows are mid-transfer (held by a pending request).
  // Use warning amber to make the lock obvious; the row links to its
  // related transfer rather than the item detail.
  transferred: { bg: 'bg-warning/10 border-warning/30', text: 'text-warning' },
  returned: { bg: 'bg-warning/10 border-warning/30', text: 'text-warning' },
}

export default function InventoryContent({
  items,
  query,
  statusFilter,
  sourceFilter,
  categoryFilter,
}: {
  items: InventoryListRow[]
  query: string
  statusFilter: InventoryStatus | ''
  sourceFilter: InventorySource | ''
  categoryFilter: InventoryCategory | ''
}) {
  const { t } = useI18n()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [searchInput, setSearchInput] = useState(query)
  const [pending, startTransition] = useTransition()

  function pushParams(next: Record<string, string | null>) {
    const sp = new URLSearchParams(searchParams.toString())
    for (const [k, v] of Object.entries(next)) {
      if (v == null || v === '') sp.delete(k)
      else sp.set(k, v)
    }
    startTransition(() => {
      router.push(`/inventory${sp.toString() ? `?${sp.toString()}` : ''}`)
    })
  }

  function onSearchSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    pushParams({ q: searchInput.trim() })
  }

  const hasFilter =
    !!query || !!statusFilter || !!sourceFilter || !!categoryFilter

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold">{t.inventory.title}</h1>
        <Link
          href="/inventory/new"
          className="inline-flex items-center gap-1 rounded-md bg-gold px-4 py-2 text-navy font-medium hover:bg-gold-2"
        >
          <Plus size={16} weight="bold" />
          <span>{t.inventory.new}</span>
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
        <form
          onSubmit={onSearchSubmit}
          className="sm:col-span-5 flex items-center gap-2"
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
              placeholder={t.inventory.searchPlaceholder}
              className="block w-full rounded-md border border-border bg-card py-2 pl-9 pr-3 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
            />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-background hover:text-foreground disabled:opacity-50"
          >
            {t.common.search}
          </button>
        </form>

        <select
          value={statusFilter}
          onChange={(e) => pushParams({ status: e.target.value })}
          className="sm:col-span-2 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
        >
          <option value="">{t.common.all} — {t.inventory.statusColumn}</option>
          <option value="available">{t.inventory.statusAvailable}</option>
          <option value="held">{t.inventory.statusHeld}</option>
          <option value="sold">{t.inventory.statusSold}</option>
          <option value="scrapped">{t.inventory.statusScrapped}</option>
          <option value="transferred">{t.inventory.statusTransferred}</option>
          <option value="returned">{t.inventory.statusReturned}</option>
        </select>

        <select
          value={sourceFilter}
          onChange={(e) => pushParams({ source: e.target.value })}
          className="sm:col-span-2 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
        >
          <option value="">{t.common.all} — {t.inventory.sourceColumn}</option>
          <option value="bought">{t.inventory.sourceBought}</option>
          <option value="pawn_forfeit">{t.inventory.sourcePawnForfeit}</option>
          <option value="consigned">{t.inventory.sourceConsigned}</option>
          <option value="new_stock">{t.inventory.sourceNewStock}</option>
          <option value="repair_excess">{t.inventory.sourceRepairExcess}</option>
          <option value="abandoned_repair">
            {t.inventory.sourceAbandonedRepair}
          </option>
        </select>

        <select
          value={categoryFilter}
          onChange={(e) => pushParams({ category: e.target.value })}
          className="sm:col-span-2 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
        >
          <option value="">
            {t.common.all} — {t.inventory.categoryColumn}
          </option>
          <option value="ring">{t.inventory.catRing}</option>
          <option value="necklace">{t.inventory.catNecklace}</option>
          <option value="bracelet">{t.inventory.catBracelet}</option>
          <option value="earrings">{t.inventory.catEarrings}</option>
          <option value="pendant">{t.inventory.catPendant}</option>
          <option value="chain">{t.inventory.catChain}</option>
          <option value="watch">{t.inventory.catWatch}</option>
          <option value="coin">{t.inventory.catCoin}</option>
          <option value="bullion">{t.inventory.catBullion}</option>
          <option value="loose_stone">{t.inventory.catLooseStone}</option>
          <option value="electronics">{t.inventory.catElectronics}</option>
          <option value="tool">{t.inventory.catTool}</option>
          <option value="instrument">{t.inventory.catInstrument}</option>
          <option value="other">{t.inventory.catOther}</option>
        </select>

        {hasFilter ? (
          <button
            type="button"
            onClick={() => {
              setSearchInput('')
              pushParams({ q: null, status: null, source: null, category: null })
            }}
            className="sm:col-span-1 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-background hover:text-foreground"
          >
            {t.common.clear}
          </button>
        ) : null}
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <p className="text-muted">
            {hasFilter ? t.inventory.emptyForFilter : t.inventory.empty}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-muted">
              <tr>
                <th className="w-16 px-3 py-3" aria-label="thumbnail" />
                <th className="px-4 py-3 font-medium">
                  {t.inventory.skuColumn}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t.inventory.descriptionColumn}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t.inventory.categoryColumn}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t.inventory.sourceColumn}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t.inventory.statusColumn}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t.inventory.priceColumn}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const badge = STATUS_BADGE[it.status]
                const price = it.sale_price ?? it.list_price
                return (
                  <tr
                    key={it.id}
                    className="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-background"
                    onClick={() => router.push(`/inventory/${it.id}`)}
                  >
                    <td className="px-3 py-2">
                      <div className="relative h-10 w-10 overflow-hidden rounded-md border border-border bg-background">
                        {it.thumb_url ? (
                          <Image
                            src={it.thumb_url}
                            alt=""
                            fill
                            sizes="40px"
                            unoptimized
                            className="object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-muted">
                            <ImageIcon size={16} />
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-foreground">
                      {it.sku}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{it.description}</div>
                      {it.brand || it.model || it.serial_number ? (
                        <div className="text-xs text-muted">
                          {[it.brand, it.model, it.serial_number]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-foreground">
                      {labelForCategory(it.category, t)}
                    </td>
                    <td className="px-4 py-3 text-foreground">
                      {labelForSource(it.source, t)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${badge.bg} ${badge.text}`}
                      >
                        {labelForStatus(it.status, t)}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-foreground">
                      {price != null ? formatMoney(price) : '—'}
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

function formatMoney(v: number | string): string {
  const n = typeof v === 'string' ? parseFloat(v) : v
  if (!isFinite(n)) return '—'
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  })
}

function labelForCategory(
  c: InventoryCategory,
  t: ReturnType<typeof useI18n>['t'],
): string {
  switch (c) {
    case 'ring': return t.inventory.catRing
    case 'necklace': return t.inventory.catNecklace
    case 'bracelet': return t.inventory.catBracelet
    case 'earrings': return t.inventory.catEarrings
    case 'pendant': return t.inventory.catPendant
    case 'chain': return t.inventory.catChain
    case 'watch': return t.inventory.catWatch
    case 'coin': return t.inventory.catCoin
    case 'bullion': return t.inventory.catBullion
    case 'loose_stone': return t.inventory.catLooseStone
    case 'electronics': return t.inventory.catElectronics
    case 'tool': return t.inventory.catTool
    case 'instrument': return t.inventory.catInstrument
    case 'other': return t.inventory.catOther
  }
}

function labelForSource(
  s: InventorySource,
  t: ReturnType<typeof useI18n>['t'],
): string {
  switch (s) {
    case 'pawn_forfeit': return t.inventory.sourcePawnForfeit
    case 'bought': return t.inventory.sourceBought
    case 'consigned': return t.inventory.sourceConsigned
    case 'new_stock': return t.inventory.sourceNewStock
    case 'repair_excess': return t.inventory.sourceRepairExcess
    case 'abandoned_repair': return t.inventory.sourceAbandonedRepair
  }
}

function labelForStatus(
  s: InventoryStatus,
  t: ReturnType<typeof useI18n>['t'],
): string {
  switch (s) {
    case 'available': return t.inventory.statusAvailable
    case 'held': return t.inventory.statusHeld
    case 'sold': return t.inventory.statusSold
    case 'scrapped': return t.inventory.statusScrapped
    // Use the active "Transferring" label for items currently held by a
    // pending transfer — distinct from "Transferred" which historically
    // could mean the lifecycle had already completed in v0 schemas.
    case 'transferred': return t.inventory.transferringBadge
    case 'returned': return t.inventory.statusReturned
  }
}
