'use client'

import { useState, useTransition } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { MagnifyingGlass, Plus, Image as ImageIcon, Tag, Warning } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { categoryLabel } from '@/lib/inventory/labels'
import { COATINGS, isSolidMetal, type Coating } from '@/lib/spot-prices/purity'
import {
  INVENTORY_CONDITIONS,
  type InventoryCondition,
} from '@/components/inventory/InventoryFormFields'
import type {
  InventoryCategory,
  InventorySource,
  InventoryStatus,
} from '@/types/database-aliases'
import PrintTagsMenu from '@/components/labels/PrintTagsMenu'
import type { TemplateChoice } from '@/lib/labels/templates'
import { resolveScanAction } from '../scan-actions'

/** Same cap as the print route (lib/labels/load MAX_TAGS_PER_PRINT). */
const MAX_TAG_SELECTION = 200

export type InventoryConditionFilter = InventoryCondition | ''
/** 'coated' = any coating other than 'none'. */
export type InventoryCoatingFilter = Coating | 'coated' | ''

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
  // patches/0067
  coating: Coating | null
  condition: InventoryCondition | null
  legacy_code: string | null
  shelf_location: string | null
  tag_printed_at: string | null
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
  conditionFilter,
  coatingFilter,
  needsTag,
  tagChoices,
}: {
  items: InventoryListRow[]
  query: string
  statusFilter: InventoryStatus | ''
  sourceFilter: InventorySource | ''
  categoryFilter: InventoryCategory | ''
  conditionFilter: InventoryConditionFilter
  coatingFilter: InventoryCoatingFilter
  needsTag: boolean
  tagChoices: TemplateChoice[]
}) {
  const { t } = useI18n()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [searchInput, setSearchInput] = useState(query)
  const [pending, startTransition] = useTransition()
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [lookingUp, setLookingUp] = useState(false)

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else if (next.size < MAX_TAG_SELECTION) next.add(id)
      return next
    })
  }
  const pageIds = items.map((i) => i.id).slice(0, MAX_TAG_SELECTION)
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id))
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(pageIds))
  }
  // Selected ids in list order, so tags print in the order shown.
  const selectedIds = items.filter((i) => selected.has(i.id)).map((i) => i.id)

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

  // A scanner types the tag's code and presses Enter: an exact code opens
  // the record (item, pawn ticket, repair ticket); anything else searches.
  async function onSearchSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const q = searchInput.trim()
    if (q) {
      setLookingUp(true)
      try {
        const hit = await resolveScanAction(q)
        if (hit.kind !== 'none') {
          router.push(hit.href)
          return
        }
      } finally {
        setLookingUp(false)
      }
    }
    pushParams({ q })
  }

  const hasFilter =
    !!query ||
    !!statusFilter ||
    !!sourceFilter ||
    !!categoryFilter ||
    !!conditionFilter ||
    !!coatingFilter ||
    needsTag

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
            disabled={pending || lookingUp}
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

        <select
          value={conditionFilter}
          onChange={(e) => pushParams({ condition: e.target.value })}
          className="sm:col-span-2 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
        >
          <option value="">
            {t.common.all} — {t.inventory.condition}
          </option>
          {INVENTORY_CONDITIONS.map((c) => (
            <option key={c} value={c}>
              {t.inventory.conditions[c]}
            </option>
          ))}
        </select>

        <select
          value={coatingFilter}
          onChange={(e) => pushParams({ coating: e.target.value })}
          className="sm:col-span-2 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
        >
          <option value="">
            {t.common.all} — {t.inventory.coating}
          </option>
          <option value="coated">{t.inventory.coatedAny}</option>
          {COATINGS.map((c) => (
            <option key={c} value={c}>
              {t.inventory.coatings[c]}
            </option>
          ))}
        </select>

        <button
          type="button"
          aria-pressed={needsTag}
          onClick={() => pushParams({ tag: needsTag ? null : 'needed' })}
          className={`sm:col-span-2 inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm ${
            needsTag
              ? 'border-gold bg-gold/10 font-semibold text-foreground'
              : 'border-border bg-card text-foreground hover:bg-background'
          }`}
        >
          <Tag size={14} weight={needsTag ? 'fill' : 'regular'} />
          {t.tags.needsTag}
        </button>

        {hasFilter ? (
          <button
            type="button"
            onClick={() => {
              setSearchInput('')
              pushParams({
                q: null,
                status: null,
                source: null,
                category: null,
                condition: null,
                coating: null,
                tag: null,
              })
            }}
            className="sm:col-span-1 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-background hover:text-foreground"
          >
            {t.common.clear}
          </button>
        ) : null}
      </div>

      {selectedIds.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gold/40 bg-gold/5 px-4 py-2">
          <span className="text-sm font-semibold text-foreground">
            {t.tags.selectedCount.replace('{count}', String(selectedIds.length))}
          </span>
          <PrintTagsMenu
            kind="inventory"
            target={{ ids: selectedIds.join(',') }}
            choices={tagChoices}
            label={t.tags.printSelected.replace('{count}', String(selectedIds.length))}
            onPrinted={() => {
              setSelected(new Set())
              // The print stamps tag_printed_at; refresh once it has run.
              setTimeout(() => router.refresh(), 2500)
            }}
          />
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-sm text-muted hover:text-foreground"
          >
            {t.tags.clearSelection}
          </button>
          {items.length > MAX_TAG_SELECTION ? (
            <span className="text-xs text-muted">
              {t.tags.maxSelected.replace('{max}', String(MAX_TAG_SELECTION))}
            </span>
          ) : null}
        </div>
      ) : null}

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
                <th className="w-10 pl-4 pr-1 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label={t.tags.selectAll}
                    className="h-4 w-4 accent-gold"
                  />
                </th>
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
                    <td className="pl-4 pr-1 py-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(it.id)}
                        onChange={() => toggleRow(it.id)}
                        aria-label={t.tags.selectRow.replace('{sku}', it.sku)}
                        className="h-4 w-4 accent-gold"
                      />
                    </td>
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
                      {!it.tag_printed_at && (it.status === 'available' || it.status === 'held') ? (
                        <span className="mt-1 flex w-fit items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 font-sans text-[10px] font-semibold text-warning">
                          <Tag size={10} weight="bold" />
                          {t.tags.needsTag}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2 font-medium text-foreground">
                        {it.description}
                        {!isSolidMetal(it.coating) ? (
                          <span
                            className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10px] font-semibold text-warning"
                            title={t.inventory.coatingWarning}
                          >
                            <Warning size={10} weight="bold" />
                            {t.inventory.coatings[it.coating ?? 'none']}
                          </span>
                        ) : null}
                      </div>
                      {it.brand || it.model || it.serial_number || it.legacy_code || it.shelf_location ? (
                        <div className="text-xs text-muted">
                          {[
                            it.brand,
                            it.model,
                            it.serial_number,
                            it.legacy_code ? `${t.inventory.legacyCode}: ${it.legacy_code}` : null,
                            it.shelf_location,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-foreground">
                      {categoryLabel(it.category, t)}
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
