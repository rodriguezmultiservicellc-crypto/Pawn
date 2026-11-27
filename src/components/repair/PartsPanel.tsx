'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Hammer, Plus } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { FOCUS } from '@/lib/ui/ledger'
import { AddPartDialog, type InventoryPartOption } from './AddPartDialog'

export type RepairPartItem = {
  id: string
  inventory_item_id: string | null
  description: string
  quantity: number
  unit_cost: number
  total_cost: number
  notes: string | null
}

const TH = 'whitespace-nowrap px-2 py-2.5 text-[12px] font-bold uppercase tracking-wide text-text-secondary'

export function PartsPanel({
  ticketId,
  parts,
  inventoryOptions,
  quoteAmount,
  readOnly,
  onAdd,
  onRemove,
}: {
  ticketId: string
  parts: RepairPartItem[]
  inventoryOptions: InventoryPartOption[]
  /** The ticket's quote: parts costing more than it are pointed out. */
  quoteAmount: number | null
  readOnly?: boolean
  onAdd: (
    formData: FormData,
  ) => Promise<{ error?: string; ok?: boolean }>
  onRemove: (
    partId: string,
  ) => Promise<{ error?: string; ok?: boolean }>
}) {
  const { t } = useI18n()
  const tp = t.repair.dialogs.addPart
  const [open, setOpen] = useState(false)

  const totalCost = parts.reduce((sum, p) => sum + (p.total_cost || 0), 0)
  // Display only: never blocks, the server checks nothing here.
  const overQuote =
    quoteAmount != null && totalCost > quoteAmount ? totalCost - quoteAmount : null

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-base font-bold text-foreground">
          <Hammer size={16} weight="regular" />
          {t.repair.detail.sectionParts}
        </h2>
        {!readOnly ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={`inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-sm font-bold text-blue hover:underline ${FOCUS}`}
          >
            <Plus size={14} weight="bold" />
            {t.repair.actions.addPart}
          </button>
        ) : null}
      </header>
      {parts.length === 0 ? (
        <div className="px-4 py-5 text-sm text-text-secondary">{t.repair.detail.noParts}</div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-left">
                  <th className={`${TH} pl-4`}>{t.repair.detail.partColumn}</th>
                  <th className={`${TH} text-right`}>{tp.quantity}</th>
                  <th className={`${TH} text-right`}>{tp.unitCost}</th>
                  <th className={`${TH} text-right`}>{tp.totalCost}</th>
                  <th className={`${TH} pr-4`}>
                    <span className="sr-only">{t.common.actions}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {parts.map((p) => (
                  <PartRow key={p.id} part={p} readOnly={readOnly} onRemove={onRemove} />
                ))}
              </tbody>
            </table>
          </div>
          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm">
            <span className="font-semibold text-warning">
              {overQuote != null
                ? t.repair.detail.partsOverQuote.replace('{diff}', fmtMoney(overQuote))
                : null}
            </span>
            <span className="text-text-secondary">
              {t.inventory.costBasis}{' '}
              <span className="font-mono font-bold text-foreground">{fmtMoney(totalCost)}</span>
            </span>
          </footer>
        </>
      )}
      {open ? (
        <AddPartDialog
          ticketId={ticketId}
          options={inventoryOptions}
          onClose={() => setOpen(false)}
          onSubmit={onAdd}
        />
      ) : null}
    </section>
  )
}

function PartRow({
  part,
  readOnly,
  onRemove,
}: {
  part: RepairPartItem
  readOnly?: boolean
  onRemove: (
    partId: string,
  ) => Promise<{ error?: string; ok?: boolean }>
}) {
  const { t } = useI18n()
  const [pending, startTransition] = useTransition()

  function remove() {
    startTransition(async () => {
      await onRemove(part.id)
    })
  }

  return (
    <tr className="border-t border-border align-top">
      <td className="py-3 pl-4 pr-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-foreground">{part.description}</span>
          {part.inventory_item_id ? (
            <Link
              href={`/inventory/${part.inventory_item_id}`}
              className="rounded-full border border-border px-2 py-0.5 text-[12px] font-semibold text-text-secondary hover:border-blue hover:text-blue"
            >
              {t.inventory.title}
            </Link>
          ) : null}
        </div>
        {part.notes ? <div className="mt-0.5 text-xs text-text-secondary">{part.notes}</div> : null}
      </td>
      <td className="px-2 py-3 text-right font-mono tabular-nums">{part.quantity}</td>
      <td className="px-2 py-3 text-right font-mono tabular-nums">{fmtMoney(part.unit_cost)}</td>
      <td className="px-2 py-3 text-right font-mono font-bold tabular-nums">
        {fmtMoney(part.total_cost)}
      </td>
      <td className="py-2 pl-2 pr-4 text-right">
        {!readOnly ? (
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            className={`inline-flex min-h-9 items-center rounded-md px-2 text-sm font-bold text-danger hover:underline disabled:opacity-50 ${FOCUS}`}
          >
            {t.repair.actions.removePart}
          </button>
        ) : null}
      </td>
    </tr>
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
