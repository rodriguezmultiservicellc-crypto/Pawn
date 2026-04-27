'use client'

import { useMemo, useState, useTransition } from 'react'
import { Prohibit } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { r4, toMoney } from '@/lib/pos/cart'
import { Modal, Footer } from './Modal'

export function CancelLayawayDialog({
  layawayId,
  paidTotal,
  cancellationFeePct,
  onClose,
  onSubmit,
}: {
  layawayId: string
  paidTotal: number
  cancellationFeePct: number
  onClose: () => void
  onSubmit: (
    formData: FormData,
  ) => Promise<{ error?: string; ok?: boolean }>
}) {
  const { t } = useI18n()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [reason, setReason] = useState<string>('')
  const [restock, setRestock] = useState<boolean>(true)

  const refundPreview = useMemo(() => {
    const fee = r4(toMoney(paidTotal) * toMoney(cancellationFeePct))
    const refund = r4(Math.max(0, toMoney(paidTotal) - fee))
    return { fee, refund }
  }, [paidTotal, cancellationFeePct])

  function submit() {
    setError(null)
    const fd = new FormData()
    fd.set('layaway_id', layawayId)
    fd.set('reason', reason)
    fd.set('restock_items', restock ? 'on' : '')
    startTransition(async () => {
      const res = await onSubmit(fd)
      if (res.error) setError(res.error)
      else onClose()
    })
  }

  return (
    <Modal title={t.pos.layaway.cancel} onClose={onClose}>
      {error ? (
        <div className="mb-3 rounded-md border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">
          {error}
        </div>
      ) : null}

      <div className="space-y-4">
        <label className="block space-y-1">
          <span className="text-sm font-medium text-ink">
            {t.pos.layaway.cancelReason}
          </span>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
          />
          <span className="block text-xs text-ash">
            {t.pos.layaway.cancelReasonHelp}
          </span>
        </label>

        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={restock}
            onChange={(e) => setRestock(e.target.checked)}
            className="h-4 w-4 rounded border-hairline"
          />
          {t.pos.layaway.cancelRestockItems}
        </label>

        <div className="rounded-md border border-hairline bg-cloud/40 p-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-ash">
                {t.pos.layaway.cancelFeePreview}
              </div>
              <div className="font-mono text-ink">
                {fmtMoney(refundPreview.fee)}
              </div>
            </div>
            <div>
              <div className="text-xs text-ash">
                {t.pos.layaway.cancelRefundPreview}
              </div>
              <div className="font-mono text-ink">
                {fmtMoney(refundPreview.refund)}
              </div>
            </div>
          </div>
        </div>
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
          disabled={pending || reason.trim().length < 10}
          onClick={submit}
          className="inline-flex items-center gap-1 rounded-md border border-error/30 bg-error/5 px-4 py-2 text-sm font-medium text-error hover:bg-error/10 disabled:opacity-50"
        >
          <Prohibit size={14} weight="bold" />
          {t.pos.layaway.cancel}
        </button>
      </Footer>
    </Modal>
  )
}

function fmtMoney(v: number): string {
  if (!isFinite(v)) return '—'
  return v.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  })
}
