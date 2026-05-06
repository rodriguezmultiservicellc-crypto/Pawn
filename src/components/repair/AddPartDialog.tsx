'use client'

import { useMemo, useState, useTransition } from 'react'
import { Plus } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { Modal, Footer } from '@/components/pawn/RecordPaymentDialog'

export type InventoryPartOption = {
  id: string
  label: string
  cost_basis: number | null
}

export function AddPartDialog({
  ticketId,
  options,
  onClose,
  onSubmit,
}: {
  ticketId: string
  options: InventoryPartOption[]
  onClose: () => void
  onSubmit: (
    formData: FormData,
  ) => Promise<{ error?: string; ok?: boolean }>
}) {
  const { t } = useI18n()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [invId, setInvId] = useState<string>('')
  const [description, setDescription] = useState<string>('')
  const [quantity, setQuantity] = useState<string>('1')
  const [unitCost, setUnitCost] = useState<string>('0')
  const [notes, setNotes] = useState<string>('')

  const totalCost = useMemo(() => {
    const q = parseFloat(quantity || '0')
    const u = parseFloat(unitCost || '0')
    if (!isFinite(q) || !isFinite(u)) return 0
    return Math.round(q * u * 10000) / 10000
  }, [quantity, unitCost])

  function pickInventoryItem(id: string) {
    setInvId(id)
    if (!id) return
    const opt = options.find((o) => o.id === id)
    if (!opt) return
    if (!description.trim()) setDescription(opt.label)
    if (opt.cost_basis != null) setUnitCost(opt.cost_basis.toFixed(2))
  }

  function submit() {
    setError(null)
    const fd = new FormData()
    fd.set('ticket_id', ticketId)
    if (invId) fd.set('inventory_item_id', invId)
    fd.set('description', description)
    fd.set('quantity', quantity || '1')
    fd.set('unit_cost', unitCost || '0')
    if (notes) fd.set('notes', notes)
    startTransition(async () => {
      const res = await onSubmit(fd)
      if (res.error) setError(res.error)
      else onClose()
    })
  }

  const canSubmit = description.trim().length >= 2

  return (
    <Modal title={t.repair.dialogs.addPart.title} onClose={onClose}>
      {error ? (
        <div className="mb-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}
      <p className="mb-3 text-sm text-muted">{t.repair.dialogs.addPart.body}</p>
      <div className="space-y-3">
        <label className="block space-y-1">
          <span className="text-sm font-medium text-foreground">
            {t.repair.dialogs.addPart.inventoryItem}
          </span>
          <select
            value={invId}
            onChange={(e) => pickInventoryItem(e.target.value)}
            className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
          >
            <option value="">{t.repair.dialogs.addPart.inventoryItemNone}</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-foreground">
            {t.repair.dialogs.addPart.description} *
          </span>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
          />
        </label>
        <div className="grid grid-cols-3 gap-3">
          <label className="block space-y-1">
            <span className="text-sm font-medium text-foreground">
              {t.repair.dialogs.addPart.quantity}
            </span>
            <input
              type="number"
              step="0.001"
              min={0}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-foreground">
              {t.repair.dialogs.addPart.unitCost}
            </span>
            <input
              type="number"
              step="0.01"
              min={0}
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
              className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
            />
          </label>
          <div className="block space-y-1">
            <span className="text-sm font-medium text-foreground">
              {t.repair.dialogs.addPart.totalCost}
            </span>
            <div className="flex h-[42px] items-center rounded-md border border-border bg-background/40 px-3 font-mono text-sm text-foreground">
              {totalCost.toFixed(4)}
            </div>
          </div>
        </div>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-foreground">
            {t.repair.new_.stoneNotes}
          </span>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
          />
        </label>
      </div>
      <Footer>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-border bg-card px-4 py-2 text-sm text-foreground hover:border-foreground"
        >
          {t.common.cancel}
        </button>
        <button
          type="button"
          disabled={pending || !canSubmit}
          onClick={submit}
          className="inline-flex items-center gap-1 rounded-md bg-gold px-4 py-2 text-sm text-navy font-medium hover:bg-gold-2 disabled:opacity-50"
        >
          <Plus size={14} weight="bold" />
          {pending ? t.common.saving : t.repair.actions.addPart}
        </button>
      </Footer>
    </Modal>
  )
}
