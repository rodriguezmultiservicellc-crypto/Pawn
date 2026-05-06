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
        <div className="mb-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}

      <div className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-foreground">
        <div className="flex items-start gap-2">
          <Warning size={16} weight="bold" className="mt-0.5 text-danger" />
          <p>{t.pawn.voidLoan.bodyWarning}</p>
        </div>
      </div>

      <label className="mt-4 block space-y-1">
        <span className="text-sm font-medium text-foreground">
          {t.pawn.voidLoan.reason} *
        </span>
        <textarea
          rows={4}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="block w-full rounded-md border border-border bg-card px-3 py-2 text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
        />
        <span className="text-xs text-muted">{t.pawn.voidLoan.reasonHelp}</span>
      </label>

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
          disabled={pending || reason.trim().length < 10}
          onClick={submit}
          className="rounded-md border border-danger/40 bg-danger/10 px-4 py-2 text-sm font-medium text-danger hover:bg-danger/20 disabled:opacity-50"
        >
          {pending ? t.pawn.voidLoan.submitting : t.pawn.voidLoan.submit}
        </button>
      </Footer>
    </Modal>
  )
}
