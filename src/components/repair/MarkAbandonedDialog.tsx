'use client'

import { useState, useTransition } from 'react'
import { Warning } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { Modal, Footer } from '@/components/pawn/RecordPaymentDialog'

export function MarkAbandonedDialog({
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
  const [reason, setReason] = useState<string>('')

  function submit() {
    setError(null)
    const fd = new FormData()
    fd.set('ticket_id', ticketId)
    fd.set('abandon_reason', reason)
    startTransition(async () => {
      const res = await onSubmit(fd)
      if (res.error) setError(res.error)
      else onClose()
    })
  }

  const canSubmit = reason.trim().length >= 10

  return (
    <Modal title={t.repair.dialogs.markAbandoned.title} onClose={onClose}>
      {error ? (
        <div className="mb-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}
      <div className="mb-3 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-warning">
        {t.repair.dialogs.markAbandoned.body}
      </div>
      <label className="block space-y-1">
        <span className="text-sm font-medium text-foreground">
          {t.repair.dialogs.markAbandoned.reason} *
        </span>
        <p className="text-xs text-muted">
          {t.repair.dialogs.markAbandoned.reasonHelp}
        </p>
        <textarea
          rows={4}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
        />
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
          disabled={pending || !canSubmit}
          onClick={submit}
          className="inline-flex items-center gap-1 rounded-md bg-danger px-4 py-2 text-sm text-white font-medium hover:bg-danger/90 disabled:opacity-50"
        >
          <Warning size={14} weight="bold" />
          {pending ? t.common.saving : t.repair.actions.markAbandoned}
        </button>
      </Footer>
    </Modal>
  )
}
