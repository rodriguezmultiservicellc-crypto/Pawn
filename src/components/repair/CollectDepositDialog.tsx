'use client'

import { useState, useTransition } from 'react'
import { CashRegister } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { Modal, Footer } from '@/components/pawn/RecordPaymentDialog'
import type { PaymentMethod } from '@/types/database-aliases'

export function CollectDepositDialog({
  ticketId,
  onClose,
  onSubmit,
}: {
  ticketId: string
  onClose: () => void
  onSubmit: (
    formData: FormData,
  ) => Promise<{ error?: string; ok?: boolean }>
}) {
  const { t } = useI18n()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [amount, setAmount] = useState<string>('')
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [notes, setNotes] = useState<string>('')

  function submit() {
    setError(null)
    const fd = new FormData()
    fd.set('ticket_id', ticketId)
    fd.set('deposit_amount', amount)
    fd.set('payment_method', method)
    if (notes) fd.set('notes', notes)
    startTransition(async () => {
      const res = await onSubmit(fd)
      if (res.error) setError(res.error)
      else onClose()
    })
  }

  const amountNum = parseFloat(amount || '0')

  return (
    <Modal title={t.repair.dialogs.collectDeposit.title} onClose={onClose}>
      {error ? (
        <div className="mb-3 rounded-md border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">
          {error}
        </div>
      ) : null}
      <p className="mb-3 text-sm text-ash">
        {t.repair.dialogs.collectDeposit.body}
      </p>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-sm font-medium text-ink">
              {t.repair.dialogs.collectDeposit.amount}
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
              {t.repair.dialogs.collectDeposit.method}
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
        <label className="block space-y-1">
          <span className="text-sm font-medium text-ink">
            {t.repair.dialogs.collectDeposit.notes}
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
          disabled={pending || !(amountNum > 0)}
          onClick={submit}
          className="inline-flex items-center gap-1 rounded-md bg-rausch px-4 py-2 text-sm text-canvas font-medium hover:bg-rausch-deep disabled:opacity-50"
        >
          <CashRegister size={14} weight="bold" />
          {pending ? t.common.saving : t.repair.actions.collectDeposit}
        </button>
      </Footer>
    </Modal>
  )
}
