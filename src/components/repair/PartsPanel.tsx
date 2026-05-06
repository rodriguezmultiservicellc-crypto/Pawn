'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Hammer, Plus, Trash } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
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

export function PartsPanel({
  ticketId,
  parts,
  inventoryOptions,
  readOnly,
  onAdd,
  onRemove,
}: {
  ticketId: string
  parts: RepairPartItem[]
  inventoryOptions: InventoryPartOption[]
  readOnly?: boolean
  onAdd: (
    formData: FormData,
  ) => Promise<{ error?: string; ok?: boolean }>
  onRemove: (
    partId: string,
  ) => Promise<{ error?: string; ok?: boolean }>
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)

  const totalCost = parts.reduce((sum, p) => sum + (p.total_cost || 0), 0)

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Hammer size={14} weight="regular" />
          {t.repair.detail.sectionParts}
        </h2>
        {!readOnly ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-foreground hover:bg-background hover:text-foreground"
          >
            <Plus size={12} weight="bold" />
            {t.repair.actions.addPart}
          </button>
        ) : null}
      </header>
      {parts.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-muted">
          {t.repair.detail.noParts}
        </div>
      ) : (
        <>
          <ul className="divide-y divide-border">
            {parts.map((p) => (
              <PartRow
                key={p.id}
                part={p}
                readOnly={readOnly}
                onRemove={onRemove}
              />
            ))}
          </ul>
          <footer className="border-t border-border bg-background/40 px-4 py-2 text-right text-xs">
            <span className="text-muted">{t.inventory.costBasis}: </span>
            <span className="font-mono text-foreground">{fmtMoney(totalCost)}</span>
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
    <li className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground">{part.description}</span>
            {part.inventory_item_id ? (
              <Link
                href={`/inventory/${part.inventory_item_id}`}
                className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-foreground hover:bg-background hover:text-foreground"
              >
                {t.inventory.title}
              </Link>
            ) : null}
          </div>
          <div className="mt-1 grid grid-cols-3 gap-3 text-xs text-muted">
            <span>
              {t.repair.dialogs.addPart.quantity}:{' '}
              <span className="font-mono text-foreground">{part.quantity}</span>
            </span>
            <span>
              {t.repair.dialogs.addPart.unitCost}:{' '}
              <span className="font-mono text-foreground">
                {fmtMoney(part.unit_cost)}
              </span>
            </span>
            <span>
              {t.repair.dialogs.addPart.totalCost}:{' '}
              <span className="font-mono text-foreground">
                {fmtMoney(part.total_cost)}
              </span>
            </span>
          </div>
          {part.notes ? (
            <div className="mt-1 text-xs text-foreground">{part.notes}</div>
          ) : null}
        </div>
        {!readOnly ? (
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md border border-danger/30 bg-danger/5 px-2 py-1 text-xs font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
          >
            <Trash size={12} weight="bold" />
            {t.repair.actions.removePart}
          </button>
        ) : null}
      </div>
    </li>
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
