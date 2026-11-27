'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Hammer, Plus } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { FOCUS } from '@/lib/ui/ledger'
import { Modal, Footer } from '@/components/pawn/RecordPaymentDialog'
import { AddPartDialog, type InventoryPartOption } from './AddPartDialog'

type RemovePart = (
  partId: string,
  reason?: string,
) => Promise<{ error?: string; ok?: boolean }>
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
  closedFix = false,
  onAdd,
  onRemove,
}: {
  ticketId: string
  parts: RepairPartItem[]
  inventoryOptions: InventoryPartOption[]
  /** The ticket's quote: parts costing more than it are pointed out. */
  quoteAmount: number | null
  /** Closed ticket: adding / removing only when closedFix. */
  readOnly?: boolean
  /** Closed ticket + owner / manager: may add or remove a part, with a reason. */
  closedFix?: boolean
  onAdd: (
    formData: FormData,
  ) => Promise<{ error?: string; ok?: boolean }>
  onRemove: RemovePart
}) {
  const { t } = useI18n()
  const tp = t.repair.dialogs.addPart
  const [open, setOpen] = useState(false)
  const [removing, setRemoving] = useState<RepairPartItem | null>(null)

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
        {!readOnly || closedFix ? (
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
          {/* relative: the sr-only header stays inside the scroll box. */}
          <div className="relative overflow-x-auto">
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
                  <PartRow
                    key={p.id}
                    part={p}
                    canRemove={!readOnly || closedFix}
                    onAskRemove={() => setRemoving(p)}
                  />
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
          closed={!!readOnly}
          onClose={() => setOpen(false)}
          onSubmit={onAdd}
        />
      ) : null}
      {removing ? (
        <RemovePartDialog
          part={removing}
          closed={!!readOnly}
          onRemove={onRemove}
          onClose={() => setRemoving(null)}
        />
      ) : null}
    </section>
  )
}

function PartRow({
  part,
  canRemove,
  onAskRemove,
}: {
  part: RepairPartItem
  canRemove: boolean
  onAskRemove: () => void
}) {
  const { t } = useI18n()

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
        {canRemove ? (
          <button
            type="button"
            onClick={onAskRemove}
            className={`inline-flex min-h-9 items-center rounded-md px-2 text-sm font-bold text-danger hover:underline ${FOCUS}`}
          >
            {t.repair.actions.removePart}
          </button>
        ) : null}
      </td>
    </tr>
  )
}

/** Confirm a removal; a closed ticket also asks why (kept in the audit log). */
function RemovePartDialog({
  part,
  closed,
  onRemove,
  onClose,
}: {
  part: RepairPartItem
  closed: boolean
  onRemove: RemovePart
  onClose: () => void
}) {
  const { t } = useI18n()
  const tr = t.repair.dialogs.removePart
  const [pending, startTransition] = useTransition()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const reasonOk = !closed || reason.trim().length >= 3

  function submit() {
    if (!reasonOk) {
      setError(tr.reasonRequired)
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        const res = await onRemove(part.id, closed ? reason.trim() : undefined)
        if (res.error) {
          setError(res.error === 'reason_required' ? tr.reasonRequired : tr.failed)
          return
        }
        onClose()
      } catch {
        setError(tr.failed)
      }
    })
  }

  return (
    <Modal title={tr.title} onClose={onClose}>
      <div className="space-y-3 text-sm text-foreground">
        <p>
          {tr.body.replace('{part}', part.description).replace('{cost}', fmtMoney(part.total_cost))}
        </p>
        {closed ? (
          <>
            <p className="text-text-secondary">{tr.closedBody}</p>
            <label className="block space-y-1">
              <span className="font-semibold">{tr.reason} *</span>
              <textarea
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                aria-required="true"
                aria-invalid={error === tr.reasonRequired}
                maxLength={500}
                className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
              />
            </label>
          </>
        ) : null}
        {error ? (
          <div role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-danger">
            {error}
          </div>
        ) : null}
      </div>
      <Footer>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-border bg-card px-4 py-2 text-sm text-foreground hover:bg-background"
        >
          {t.common.cancel}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded-md bg-danger px-4 py-2 text-sm font-medium text-white hover:bg-danger/90 disabled:opacity-50"
        >
          {pending ? t.common.saving : tr.confirm}
        </button>
      </Footer>
    </Modal>
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
