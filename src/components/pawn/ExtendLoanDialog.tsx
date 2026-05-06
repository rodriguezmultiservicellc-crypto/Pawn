'use client'

import { useState, useTransition } from 'react'
import { Calendar } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { addDaysIso, todayDateString } from '@/lib/pawn/math'
import { Modal, Footer } from './RecordPaymentDialog'
import type { PaymentMethod } from '@/types/database-aliases'

export function ExtendLoanDialog({
  loanId,
  onClose,
  onSubmit,
}: {
  loanId: string
  onClose: () => void
  onSubmit: (
    formData: FormData,
  ) => Promise<{ error?: string; ok?: boolean }>
}) {
  const { t } = useI18n()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [newTermDays, setNewTermDays] = useState<string>('30')
  const [interestNow, setInterestNow] = useState<string>('0')
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [notes, setNotes] = useState<string>('')

  const termInt = parseInt(newTermDays || '0', 10)
  const previewDueDate =
    termInt > 0 ? addDaysIso(todayDateString(), termInt) : null

  function submit() {
    setError(null)
    const fd = new FormData()
    fd.set('loan_id', loanId)
    fd.set('new_term_days', newTermDays)
    fd.set('interest_collected_now', interestNow || '0')
    fd.set('payment_method', method)
    if (notes) fd.set('notes', notes)
    startTransition(async () => {
      const res = await onSubmit(fd)
      if (res.error) setError(res.error)
      else onClose()
    })
  }

  return (
    <Modal title={t.pawn.extension.title} onClose={onClose}>
      {error ? (
        <div className="mb-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}

      <div className="space-y-4">
        <label className="block space-y-1">
          <span className="text-sm font-medium text-foreground">
            {t.pawn.extension.newTermDays}
          </span>
          <input
            type="number"
            min={1}
            max={180}
            value={newTermDays}
            onChange={(e) => setNewTermDays(e.target.value)}
            className="block w-full rounded-md border border-border bg-card px-3 py-2 text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-sm font-medium text-foreground">
              {t.pawn.extension.interestCollectedNow}
            </span>
            <input
              type="number"
              step="0.01"
              min={0}
              value={interestNow}
              onChange={(e) => setInterestNow(e.target.value)}
              className="block w-full rounded-md border border-border bg-card px-3 py-2 text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-foreground">
              {t.pawn.extension.paymentMethod}
            </span>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethod)}
              className="block w-full rounded-md border border-border bg-card px-3 py-2 text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
            >
              <option value="cash">{t.pawn.payment.methodCash}</option>
              <option value="card">{t.pawn.payment.methodCard}</option>
              <option value="check">{t.pawn.payment.methodCheck}</option>
              <option value="other">{t.pawn.payment.methodOther}</option>
            </select>
          </label>
        </div>

        {previewDueDate ? (
          <div className="rounded-md border border-border bg-background/40 p-3 text-sm">
            <div className="flex items-center gap-2 text-foreground">
              <Calendar size={14} weight="bold" />
              <span className="font-medium">
                {t.pawn.extension.newDueDate}:
              </span>
              <span className="font-mono">{previewDueDate}</span>
            </div>
            <p className="mt-1 text-xs text-muted">
              {t.pawn.extension.newDueDateHelp}
            </p>
          </div>
        ) : null}

        <label className="block space-y-1">
          <span className="text-sm font-medium text-foreground">
            {t.pawn.new_.notes}
          </span>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="block w-full rounded-md border border-border bg-card px-3 py-2 text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
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
          disabled={pending || termInt <= 0}
          onClick={submit}
          className="rounded-md bg-gold px-4 py-2 text-sm text-navy font-medium hover:bg-gold-2 disabled:opacity-50"
        >
          {pending ? t.pawn.extension.submitting : t.pawn.extension.submit}
        </button>
      </Footer>
    </Modal>
  )
}
