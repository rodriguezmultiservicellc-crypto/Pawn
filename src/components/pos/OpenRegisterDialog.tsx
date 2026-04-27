'use client'

import { useState, useTransition } from 'react'
import { CashRegister } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { Modal, Footer } from './Modal'

export function OpenRegisterDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void
  onSubmit: (
    formData: FormData,
  ) => Promise<{ error?: string; ok?: boolean }>
}) {
  const { t } = useI18n()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [openingCash, setOpeningCash] = useState<string>('0.00')
  const [notes, setNotes] = useState<string>('')

  function submit() {
    setError(null)
    const fd = new FormData()
    fd.set('opening_cash', openingCash)
    if (notes) fd.set('notes', notes)
    startTransition(async () => {
      const res = await onSubmit(fd)
      if (res.error) setError(res.error)
      else onClose()
    })
  }

  return (
    <Modal title={t.pos.register.open} onClose={onClose}>
      {error ? (
        <div className="mb-3 rounded-md border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">
          {error}
        </div>
      ) : null}

      <div className="space-y-4">
        <label className="block space-y-1">
          <span className="text-sm font-medium text-ink">
            {t.pos.register.openingCash}
          </span>
          <input
            type="number"
            step="0.01"
            min={0}
            value={openingCash}
            onChange={(e) => setOpeningCash(e.target.value)}
            className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
          />
          <span className="block text-xs text-ash">
            {t.pos.register.openingCashHelp}
          </span>
        </label>
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
          {pending ? t.pos.register.opening : t.pos.register.open}
        </button>
      </Footer>
    </Modal>
  )
}
