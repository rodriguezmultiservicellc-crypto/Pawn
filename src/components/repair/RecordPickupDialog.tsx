'use client'

import { useRef, useState, useTransition } from 'react'
import { CheckCircle, Upload } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { Modal, Footer } from '@/components/pawn/RecordPaymentDialog'
import type { PaymentMethod } from '@/types/database-aliases'

export function RecordPickupDialog({
  ticketId,
  balanceDue,
  onClose,
  onSubmit,
}: {
  ticketId: string
  /** Outstanding balance due at pickup; null when no quote was set. */
  balanceDue: number | null
  onClose: () => void
  onSubmit: (
    formData: FormData,
  ) => Promise<{ error?: string; ok?: boolean }>
}) {
  const { t } = useI18n()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState<string>('')
  const [idCheck, setIdCheck] = useState<string>('')
  const [amount, setAmount] = useState<string>(
    balanceDue != null ? balanceDue.toFixed(2) : '0.00',
  )
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [notes, setNotes] = useState<string>('')
  const sigRef = useRef<HTMLInputElement>(null)
  const [sigFileName, setSigFileName] = useState<string | null>(null)

  function onSigChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    setSigFileName(f ? f.name : null)
  }

  function submit() {
    setError(null)
    const fd = new FormData()
    fd.set('ticket_id', ticketId)
    fd.set('pickup_by_name', name)
    if (idCheck) fd.set('pickup_id_check', idCheck)
    fd.set('paid_amount', amount || '0')
    fd.set('payment_method', method)
    if (notes) fd.set('notes', notes)
    const sig = sigRef.current?.files?.[0]
    if (sig) fd.set('signature_file', sig)
    startTransition(async () => {
      const res = await onSubmit(fd)
      if (res.error) setError(res.error)
      else onClose()
    })
  }

  const trimmedName = name.trim()
  const canSubmit = trimmedName.length >= 2

  return (
    <Modal title={t.repair.dialogs.recordPickup.title} onClose={onClose}>
      {error ? (
        <div className="mb-3 rounded-md border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">
          {error}
        </div>
      ) : null}
      <p className="mb-3 text-sm text-ash">
        {t.repair.dialogs.recordPickup.body}
      </p>
      <div className="space-y-4">
        <label className="block space-y-1">
          <span className="text-sm font-medium text-ink">
            {t.repair.dialogs.recordPickup.pickupBy} *
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-ink">
            {t.repair.dialogs.recordPickup.idCheck}
          </span>
          <input
            type="text"
            value={idCheck}
            onChange={(e) => setIdCheck(e.target.value)}
            placeholder={t.repair.dialogs.recordPickup.idCheckPlaceholder}
            className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-sm font-medium text-ink">
              {t.repair.dialogs.recordPickup.amount}
            </span>
            <input
              type="number"
              step="0.01"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-ink">
              {t.repair.dialogs.recordPickup.method}
            </span>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethod)}
              className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
            >
              <option value="cash">{t.pawn.payment.methodCash}</option>
              <option value="card">{t.pawn.payment.methodCard}</option>
              <option value="check">{t.pawn.payment.methodCheck}</option>
              <option value="other">{t.pawn.payment.methodOther}</option>
            </select>
          </label>
        </div>

        <div>
          <span className="block text-sm font-medium text-ink">
            {t.repair.dialogs.recordPickup.signature}
          </span>
          <p className="mb-1 text-xs text-ash">
            {t.repair.dialogs.recordPickup.signatureHelp}
          </p>
          <button
            type="button"
            onClick={() => sigRef.current?.click()}
            className="inline-flex items-center gap-1 rounded-md border border-dashed border-hairline bg-canvas px-3 py-2 text-sm font-medium text-ink hover:border-ink"
          >
            <Upload size={14} weight="bold" />
            {sigFileName ?? t.common.upload}
          </button>
          <input
            ref={sigRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
            onChange={onSigChange}
            className="sr-only"
          />
        </div>

        <label className="block space-y-1">
          <span className="text-sm font-medium text-ink">
            {t.repair.dialogs.recordPickup.notes}
          </span>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
          />
        </label>
      </div>
      <Footer>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-hairline bg-canvas px-4 py-2 text-sm text-ink hover:border-ink"
        >
          {t.common.cancel}
        </button>
        <button
          type="button"
          disabled={pending || !canSubmit}
          onClick={submit}
          className="inline-flex items-center gap-1 rounded-md bg-success px-4 py-2 text-sm text-canvas font-medium hover:bg-success-deep disabled:opacity-50"
        >
          <CheckCircle size={14} weight="bold" />
          {pending ? t.common.saving : t.repair.actions.recordPickup}
        </button>
      </Footer>
    </Modal>
  )
}
