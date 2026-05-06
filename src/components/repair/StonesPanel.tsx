'use client'

import { useState, useTransition } from 'react'
import { Diamond, Plus, Trash } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { AddStoneDialog } from './AddStoneDialog'

export type RepairStoneItem = {
  id: string
  stone_index: number
  stone_type: string
  shape: string | null
  size_mm: number | null
  weight_carats: number | null
  color: string | null
  clarity: string | null
  mounting_type: string | null
  mounting_position: string | null
  source: 'customer_supplied' | 'shop_supplied'
  notes: string | null
}

export function StonesPanel({
  ticketId,
  stones,
  readOnly,
  onAdd,
  onRemove,
}: {
  ticketId: string
  stones: RepairStoneItem[]
  readOnly?: boolean
  onAdd: (
    formData: FormData,
  ) => Promise<{ error?: string; ok?: boolean }>
  onRemove: (
    stoneId: string,
  ) => Promise<{ error?: string; ok?: boolean }>
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)

  const nextIndex =
    stones.reduce((max, s) => (s.stone_index > max ? s.stone_index : max), 0) + 1

  return (
    <section className="rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Diamond size={14} weight="regular" />
          {t.repair.detail.sectionStones}
        </h2>
        {!readOnly ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-foreground hover:border-foreground"
          >
            <Plus size={12} weight="bold" />
            {t.repair.actions.addStone}
          </button>
        ) : null}
      </header>
      {stones.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-muted">
          {t.repair.detail.noStones}
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {stones.map((s) => (
            <StoneRow
              key={s.id}
              stone={s}
              readOnly={readOnly}
              onRemove={onRemove}
            />
          ))}
        </ul>
      )}
      {open ? (
        <AddStoneDialog
          ticketId={ticketId}
          nextIndex={nextIndex}
          onClose={() => setOpen(false)}
          onSubmit={onAdd}
        />
      ) : null}
    </section>
  )
}

function StoneRow({
  stone,
  readOnly,
  onRemove,
}: {
  stone: RepairStoneItem
  readOnly?: boolean
  onRemove: (
    stoneId: string,
  ) => Promise<{ error?: string; ok?: boolean }>
}) {
  const { t } = useI18n()
  const [pending, startTransition] = useTransition()

  function remove() {
    startTransition(async () => {
      await onRemove(stone.id)
    })
  }

  const sourceLabel =
    stone.source === 'customer_supplied'
      ? t.repair.new_.stoneSourceCustomer
      : t.repair.new_.stoneSourceShop

  return (
    <li className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-mono text-foreground">
              #{stone.stone_index}
            </span>
            <span className="font-medium text-foreground">{stone.stone_type}</span>
            <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-muted">
              {sourceLabel}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
            {stone.shape ? <span>{stone.shape}</span> : null}
            {stone.size_mm != null ? <span>{stone.size_mm}mm</span> : null}
            {stone.weight_carats != null ? (
              <span>{stone.weight_carats}ct</span>
            ) : null}
            {stone.color ? <span>{stone.color}</span> : null}
            {stone.clarity ? <span>{stone.clarity}</span> : null}
            {stone.mounting_type ? <span>{stone.mounting_type}</span> : null}
            {stone.mounting_position ? (
              <span>{stone.mounting_position}</span>
            ) : null}
          </div>
          {stone.notes ? (
            <div className="mt-1 text-xs text-foreground">{stone.notes}</div>
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
            {t.repair.actions.removeStone}
          </button>
        ) : null}
      </div>
    </li>
  )
}
