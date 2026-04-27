'use client'

import { useState, useTransition } from 'react'
import { Tag } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { Modal, Footer } from '@/components/pawn/RecordPaymentDialog'

export function SetQuoteDialog({
  ticketId,
  initialAmount,
  onClose,
  onSubmit,
}: {
  ticketId: string
  initialAmount?: number | null
  onClose: () => void
  onSubmit: (
    formData: FormData,
  ) => Promise<{ error?: string; ok?: boolean }>
}) {
  const { t } = useI18n()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [amount, setAmount] = useState<string>(
    initialAmount != null ? initialAmount.toFixed(2) : '',
  )
  const [notes, setNotes] = useState<string>('')

  function submit() {
    setError(null)
    const fd = new FormData()
    fd.set('ticket_id', ticketId)
    fd.set('quote_amount', amount)
    if (notes) fd.set('notes', notes)
    startTransition(async () => {
      const res = await onSubmit(fd)
      if (res.error) setError(res.error)
      else onClose()
    })
  }

  const amountNum = parseFloat(amount || '0')

  return (
    <Modal title={t.repair.dialogs.setQuote.title} onClose={onClose}>
      {error ? (
        <div className="mb-3 rounded-md border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">
          {error}
        </div>
      ) : null}
      <p className="mb-3 text-sm text-ash">{t.repair.dialogs.setQuote.body}</p>
      <div className="space-y-4">
        <label className="block space-y-1">
          <span className="text-sm font-medium text-ink">
            {t.repair.dialogs.setQuote.amount}
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
            {t.repair.dialogs.setQuote.notes}
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
          <Tag size={14} weight="bold" />
          {pending ? t.common.saving : t.repair.actions.setQuote}
        </button>
      </Footer>
    </Modal>
  )
}
