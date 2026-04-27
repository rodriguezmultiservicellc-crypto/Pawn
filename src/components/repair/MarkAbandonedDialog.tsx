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
        <div className="mb-3 rounded-md border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">
          {error}
        </div>
      ) : null}
      <div className="mb-3 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-warning">
        {t.repair.dialogs.markAbandoned.body}
      </div>
      <label className="block space-y-1">
        <span className="text-sm font-medium text-ink">
          {t.repair.dialogs.markAbandoned.reason} *
        </span>
        <p className="text-xs text-ash">
          {t.repair.dialogs.markAbandoned.reasonHelp}
        </p>
        <textarea
          rows={4}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
        />
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
          disabled={pending || !canSubmit}
          onClick={submit}
          className="inline-flex items-center gap-1 rounded-md bg-error px-4 py-2 text-sm text-canvas font-medium hover:bg-error/90 disabled:opacity-50"
        >
          <Warning size={14} weight="bold" />
          {pending ? t.common.saving : t.repair.actions.markAbandoned}
        </button>
      </Footer>
    </Modal>
  )
}
