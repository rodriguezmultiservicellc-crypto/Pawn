'use client'

import { useState, useTransition } from 'react'
import { Warning } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { Modal, Footer } from './RecordPaymentDialog'

/**
 * A manager voids ONE payment — the last one on the ticket. Nothing is
 * erased: the server writes a reversal beside it, puts the due date back if
 * that payment moved it, and reopens the ticket if that payment paid it off
 * (voidPaymentAction / lib/pawn/payment-void). The dialog says which of
 * those will happen and asks why.
 */
export function VoidPaymentDialog({
  loanId,
  eventId,
  amountLabel,
  paidAtLabel,
  restoreDueDate,
  reopens,
  onClose,
  onSubmit,
}: {
  loanId: string
  eventId: string
  /** "$80.00" */
  amountLabel: string
  /** When it was taken, as the event log shows it. */
  paidAtLabel: string
  /** The due date that comes back; null when the payment did not move it. */
  restoreDueDate: string | null
  /** The payment paid the ticket off: it will be open again. */
  reopens: boolean
  onClose: () => void
  onSubmit: (
    formData: FormData,
  ) => Promise<{ error?: string; ok?: boolean }>
}) {
  const { t } = useI18n()
  const tv = t.pawn.voidPayment
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [reason, setReason] = useState<string>('')

  function submit() {
    setError(null)
    if (reason.trim().length < 10) {
      setError(tv.reasonHelp)
      return
    }
    const fd = new FormData()
    fd.set('loan_id', loanId)
    fd.set('event_id', eventId)
    fd.set('reason', reason)
    startTransition(async () => {
      const res = await onSubmit(fd)
      if (res.error) {
        const known = tv.errors as Record<string, string>
        setError(known[res.error] ?? known.void_failed)
      } else onClose()
    })
  }

  return (
    <Modal title={tv.title} onClose={onClose}>
      {error ? (
        <div className="mb-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}

      <div className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-foreground">
        <div className="flex items-start gap-2">
          <Warning size={16} weight="bold" className="mt-0.5 shrink-0 text-danger" />
          <div className="space-y-1">
            <p className="font-semibold">
              {tv.body.replace('{amount}', amountLabel).replace('{date}', paidAtLabel)}
            </p>
            <p>{tv.keeps}</p>
            {restoreDueDate ? (
              <p>{tv.dueDateBack.replace('{date}', restoreDueDate)}</p>
            ) : null}
            {reopens ? <p>{tv.reopens}</p> : null}
            <p>{tv.cash}</p>
          </div>
        </div>
      </div>

      <label className="mt-4 block space-y-1">
        <span className="text-sm font-medium text-foreground">{tv.reason} *</span>
        <textarea
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
        />
        <span className="block text-xs text-muted">{tv.reasonHelp}</span>
      </label>

      <Footer>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-border bg-card px-4 py-2 text-sm text-foreground hover:bg-background hover:text-foreground"
        >
          {t.common.cancel}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={submit}
          className="rounded-md bg-danger px-4 py-2 text-sm font-medium text-white hover:bg-danger/90 disabled:opacity-50"
        >
          {pending ? tv.submitting : tv.submit}
        </button>
      </Footer>
    </Modal>
  )
}
