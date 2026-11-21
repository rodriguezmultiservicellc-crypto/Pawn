'use client'

import { useState, useTransition } from 'react'
import { Prohibit } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { Modal, Footer } from './Modal'

export function VoidSaleDialog({
  saleId,
  onClose,
  onSubmit,
}: {
  saleId: string
  onClose: () => void
  onSubmit: (
    formData: FormData,
  ) => Promise<{ error?: string; ok?: boolean; detail?: string }>
}) {
  const { t } = useI18n()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [reason, setReason] = useState<string>('')

  function submit() {
    setError(null)
    const fd = new FormData()
    fd.set('sale_id', saleId)
    fd.set('reason', reason)
    startTransition(async () => {
      const res = await onSubmit(fd)
      if (res.error) {
        const errors = t.pos.errors as Record<string, string>
        setError((errors[res.error] ?? errors.generic).replace('{detail}', res.detail ?? ''))
      } else onClose()
    })
  }

  return (
    <Modal title={t.pos.sale.voidSale} onClose={onClose}>
      {error ? (
        <div className="mb-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}
      <div className="space-y-4">
        <label className="block space-y-1">
          <span className="text-sm font-medium text-foreground">
            {t.pos.return.reason}
          </span>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
          />
          <span className="block text-xs text-muted">
            {t.pos.return.reasonHelp}
          </span>
        </label>
        <p className="rounded-md border border-info/30 bg-info/5 px-3 py-2 text-xs text-foreground">
          {t.pos.sale.voidRefundNote}
        </p>
      </div>
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
          disabled={pending || reason.trim().length < 10}
          onClick={submit}
          className="inline-flex items-center gap-1 rounded-md border border-danger/30 bg-danger/5 px-4 py-2 text-sm font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
        >
          <Prohibit size={14} weight="bold" />
          {t.pos.sale.voidSale}
        </button>
      </Footer>
    </Modal>
  )
}
