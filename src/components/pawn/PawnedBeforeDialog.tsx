'use client'

import { useMemo, useState } from 'react'
import { Check, MagnifyingGlass, Plus } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { formatMoney, shortDate } from '@/lib/format/money'
import type { PreviousPawnItem } from '@/lib/pawn/customer-history'
import { Modal, Footer } from './RecordPaymentDialog'

/**
 * The pieces this customer pawned and picked up before, as a list. The
 * clerk adds the ones the customer brought back — one or several — and each
 * lands on the ticket filled in, with what was lent on it last time.
 *
 * One pill opens it (CollateralItemsList). It used to be one pill per piece,
 * which buried the form under a regular customer's history.
 */
export function PawnedBeforeDialog({
  items,
  addedKeys,
  onAdd,
  onClose,
}: {
  items: ReadonlyArray<PreviousPawnItem>
  /** Pieces already put on this ticket from the list. */
  addedKeys: ReadonlySet<string>
  onAdd: (item: PreviousPawnItem) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const th = t.pawn.new_.history
  const [query, setQuery] = useState('')

  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (words.length === 0) return items
    return items.filter((p) => {
      const text = `${p.label} ${p.last_ticket}`.toLowerCase()
      return words.every((w) => text.includes(w))
    })
  }, [items, query])

  return (
    <Modal title={th.pawnedBeforeTitle} onClose={onClose}>
      <p className="-mt-2 mb-3 text-sm text-muted">{th.pawnedBeforeIntro}</p>

      {items.length > 6 ? (
        <label className="relative mb-3 block">
          <MagnifyingGlass
            size={16}
            weight="bold"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={th.pawnedBeforeSearch}
            aria-label={th.pawnedBeforeSearch}
            autoFocus
            className="block w-full rounded-xl border-2 border-border bg-background py-2.5 pl-9 pr-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
          />
        </label>
      ) : null}

      <ul className="max-h-[55vh] divide-y divide-border overflow-y-auto rounded-xl border border-border">
        {shown.length === 0 ? (
          <li className="px-3 py-4 text-center text-sm text-muted">{th.pawnedBeforeNoMatch}</li>
        ) : (
          shown.map((p) => {
            const added = addedKeys.has(p.key)
            return (
              <li key={p.key} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-foreground">{p.label}</div>
                  <div className="mt-0.5 text-xs text-muted">
                    {th.pawnedBeforeLast
                      .replace('{ticket}', p.last_ticket)
                      .replace('{date}', shortDate(p.last_date))}
                    {p.times > 1 ? ` · ${th.pawnedBeforeTimes.replace('{n}', String(p.times))}` : ''}
                  </div>
                </div>
                {p.last_value > 0 ? (
                  <span className="shrink-0 font-mono text-sm font-bold text-foreground">
                    {formatMoney(p.last_value)}
                  </span>
                ) : null}
                <button
                  type="button"
                  // On the ticket already: no second copy. Removing its row
                  // from the ticket turns this back into Add.
                  disabled={added}
                  onClick={() => onAdd(p)}
                  className={`inline-flex h-9 shrink-0 items-center gap-1 rounded-lg px-3 text-xs font-bold transition-colors ${
                    added
                      ? 'cursor-default border border-success/40 bg-success/5 text-success'
                      : 'bg-gold text-navy hover:bg-gold-2'
                  }`}
                >
                  {added ? <Check size={14} weight="bold" /> : <Plus size={14} weight="bold" />}
                  {added ? th.pawnedBeforeAdded : th.pawnedBeforeAdd}
                </button>
              </li>
            )
          })
        )}
      </ul>

      <Footer>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md bg-navy px-4 py-2 text-sm font-medium text-white hover:bg-navy/90"
        >
          {th.pawnedBeforeDone}
        </button>
      </Footer>
    </Modal>
  )
}
