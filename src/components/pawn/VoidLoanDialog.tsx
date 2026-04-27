'use client'

import { useState, useTransition } from 'react'
import { Warning } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { Modal, Footer } from './RecordPaymentDialog'

export function VoidLoanDialog({
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
  const [reason, setReason] = useState<string>('')

  function submit() {
    setError(null)
    if (reason.trim().length < 10) {
      setError(t.pawn.voidLoan.reasonHelp)
      return
    }
    const fd = new FormData()
    fd.set('loan_id', loanId)
    fd.set('reason', reason)
    startTransition(async () => {
      const res = await onSubmit(fd)
      if (res.error) setError(res.error)
      else onClose()
    })
  }

  return (
    <Modal title={t.pawn.voidLoan.title} onClose={onClose}>
      {error ? (
        <div className="mb-3 rounded-md border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">
          {error}
        </div>
      ) : null}

      <div className="rounded-md border border-error/30 bg-error/5 p-3 text-sm text-ink">
        <div className="flex items-start gap-2">
          <Warning size={16} weight="bold" className="mt-0.5 text-error" />
          <p>{t.pawn.voidLoan.bodyWarning}</p>
        </div>
      </div>

      <label className="mt-4 block space-y-1">
        <span className="text-sm font-medium text-ink">
          {t.pawn.voidLoan.reason} *
        </span>
        <textarea
          rows={4}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
        />
        <span className="text-xs text-ash">{t.pawn.voidLoan.reasonHelp}</span>
      </label>

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
          disabled={pending || reason.trim().length < 10}
          onClick={submit}
          className="rounded-md border border-error/40 bg-error/10 px-4 py-2 text-sm font-medium text-error hover:bg-error/20 disabled:opacity-50"
        >
          {pending ? t.pawn.voidLoan.submitting : t.pawn.voidLoan.submit}
        </button>
      </Footer>
    </Modal>
  )
}
