'use client'

import { useMemo, useState, useTransition } from 'react'
import { CashRegister } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { cashVariance } from '@/lib/pos/register'
import { r4 } from '@/lib/pos/cart'
import { Modal, Footer } from './Modal'

export function CloseRegisterDialog({
  sessionId,
  expectedCash,
  onClose,
  onSubmit,
}: {
  sessionId: string
  expectedCash: number
  onClose: () => void
  onSubmit: (
    formData: FormData,
  ) => Promise<{ error?: string; ok?: boolean }>
}) {
  const { t } = useI18n()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [counted, setCounted] = useState<string>(expectedCash.toFixed(2))
  const [cardBatch, setCardBatch] = useState<string>('0.00')
  const [notes, setNotes] = useState<string>('')

  const variance = useMemo(() => {
    return cashVariance({
      counted: counted,
      expected: expectedCash,
    })
  }, [counted, expectedCash])

  function submit() {
    setError(null)
    const fd = new FormData()
    fd.set('session_id', sessionId)
    fd.set('closing_cash_counted', counted)
    fd.set('card_batch_total', cardBatch)
    if (notes) fd.set('notes', notes)
    startTransition(async () => {
      const res = await onSubmit(fd)
      if (res.error) setError(res.error)
      else onClose()
    })
  }

  const varianceTone =
    r4(variance) === 0
      ? 'text-ink'
      : variance > 0
        ? 'text-success'
        : 'text-error'
  const varianceLabel =
    variance > 0
      ? t.pos.register.over
      : variance < 0
        ? t.pos.register.short
        : ''

  return (
    <Modal title={t.pos.register.close} onClose={onClose}>
      {error ? (
        <div className="mb-3 rounded-md border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">
          {error}
        </div>
      ) : null}

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-sm font-medium text-ink">
              {t.pos.register.closingCash}
            </span>
            <input
              type="number"
              step="0.01"
              min={0}
              value={counted}
              onChange={(e) => setCounted(e.target.value)}
              className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
            />
            <span className="block text-xs text-ash">
              {t.pos.register.closingCashHelp}
            </span>
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-ink">
              {t.pos.register.cardBatchTotal}
            </span>
            <input
              type="number"
              step="0.01"
              min={0}
              value={cardBatch}
              onChange={(e) => setCardBatch(e.target.value)}
              className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
            />
          </label>
        </div>

        <div className="rounded-md border border-hairline bg-cloud/40 p-3">
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div>
              <div className="text-xs text-ash">{t.pos.register.expected}</div>
              <div className="font-mono text-ink">
                {fmtMoney(expectedCash)}
              </div>
            </div>
            <div>
              <div className="text-xs text-ash">{t.pos.register.counted}</div>
              <div className="font-mono text-ink">
                {fmtMoney(parseFloat(counted || '0'))}
              </div>
            </div>
            <div>
              <div className="text-xs text-ash">
                {t.pos.register.variance}
              </div>
              <div className={`font-mono ${varianceTone}`}>
                {fmtMoney(variance)}{' '}
                {varianceLabel ? (
                  <span className="text-xs">({varianceLabel})</span>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <label className="block space-y-1">
          <span className="text-sm font-medium text-ink">
            {t.pos.register.notes}
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
          disabled={pending}
          onClick={submit}
          className="inline-flex items-center gap-1 rounded-md bg-rausch px-4 py-2 text-sm font-medium text-canvas hover:bg-rausch-deep disabled:opacity-50"
        >
          <CashRegister size={14} weight="bold" />
          {pending ? t.pos.register.closing : t.pos.register.close}
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
