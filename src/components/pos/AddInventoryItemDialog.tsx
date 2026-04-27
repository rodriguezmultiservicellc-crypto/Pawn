'use client'

import { useMemo, useState } from 'react'
import { MagnifyingGlass, Package, Plus } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { Modal, Footer } from './Modal'

export type InventoryPickRow = {
  id: string
  sku: string
  description: string
  list_price: number | null
  category: string | null
}

export function AddInventoryItemDialog({
  items,
  onClose,
  onPick,
}: {
  items: InventoryPickRow[]
  onClose: () => void
  onPick: (item: InventoryPickRow) => void
}) {
  const { t } = useI18n()
  const [q, setQ] = useState<string>('')

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase()
    if (!ql) return items
    return items.filter(
      (i) =>
        i.sku.toLowerCase().includes(ql) ||
        i.description.toLowerCase().includes(ql),
    )
  }, [items, q])

  return (
    <Modal title={t.pos.sale.searchInventory} onClose={onClose} size="lg">
      <div className="space-y-3">
        <div className="relative">
          <MagnifyingGlass
            size={14}
            weight="bold"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ash"
          />
          <input
            type="search"
            placeholder={t.inventory.searchPlaceholder}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
            className="block w-full rounded-md border border-hairline bg-canvas py-2 pl-8 pr-3 text-sm text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
          />
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-md border border-hairline bg-cloud/40 p-6 text-center text-sm text-ash">
            {t.inventory.emptyForFilter}
          </div>
        ) : (
          <ul className="max-h-96 divide-y divide-hairline overflow-auto rounded-md border border-hairline">
            {filtered.slice(0, 100).map((it) => (
              <li key={it.id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(it)
                    onClose()
                  }}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-cloud"
                >
                  <Package
                    size={20}
                    weight="regular"
                    className="shrink-0 text-ash"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-ink">
                      {it.description}
                    </div>
                    <div className="truncate font-mono text-xs text-ash">
                      {it.sku}
                    </div>
                  </div>
                  <div className="shrink-0 font-mono text-sm text-ink">
                    {it.list_price == null
                      ? '—'
                      : it.list_price.toLocaleString('en-US', {
                          style: 'currency',
                          currency: 'USD',
                          minimumFractionDigits: 2,
                        })}
                  </div>
                  <Plus size={14} weight="bold" className="shrink-0 text-ash" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Footer>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-hairline bg-canvas px-4 py-2 text-sm text-ink hover:border-ink"
        >
          {t.common.close}
        </button>
      </Footer>
    </Modal>
  )
}
