'use client'

import { useState, useTransition } from 'react'
import { CashRegister, CreditCard, Flask } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { Modal, Footer } from './Modal'
import { CardSlipFields, EMPTY_SLIP, slipComplete, type CardSlip } from './CardSlipFields'

/** What the clerk picks. 'card_machine' is a card run on the shop's own machine (0085). */
type Choice = 'cash' | 'card_machine' | 'card' | 'check' | 'other'

export function AddPaymentDialog({
  saleId,
  defaultAmount,
  onClose,
  onSubmit,
}: {
  saleId: string
  defaultAmount: number
  onClose: () => void
  onSubmit: (
    formData: FormData,
  ) => Promise<{ error?: string; ok?: boolean }>
}) {
  const { t } = useI18n()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [amount, setAmount] = useState<string>(defaultAmount.toFixed(2))
  const [method, setMethod] = useState<Choice>('cash')
  const [slip, setSlip] = useState<CardSlip>(EMPTY_SLIP)
  const [readerId, setReaderId] = useState<string>('')
  const [notes, setNotes] = useState<string>('')

  function submit() {
    setError(null)
    const fd = new FormData()
    fd.set('sale_id', saleId)
    fd.set('amount', amount)
    if (method === 'card_machine') {
      fd.set('payment_method', 'card')
      fd.set('card_entry', 'external')
      fd.set('card_last4', slip.last4)
      fd.set('card_brand', slip.brand)
      if (slip.auth_code) fd.set('card_auth_code', slip.auth_code)
    } else {
      fd.set('payment_method', method)
      if (readerId) fd.set('reader_id', readerId)
    }
    if (notes) fd.set('notes', notes)
    startTransition(async () => {
      const res = await onSubmit(fd)
      if (res.error) {
        const errors = t.pos.errors as Record<string, string>
        setError(errors[res.error] ?? errors.generic)
      } else onClose()
    })
  }

  const isCard = method === 'card'
  const isMachine = method === 'card_machine'

  return (
    <Modal title={t.pos.payment.title} onClose={onClose}>
      {error ? (
        <div className="mb-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-sm font-medium text-foreground">
              {t.pos.payment.amount}
            </span>
            <input
              type="number"
              step="0.01"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-foreground">
              {t.pos.payment.method}
            </span>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as Choice)}
              className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
            >
              <option value="cash">{t.pos.payment.methodCash}</option>
              <option value="card_machine">{t.pos.card.methodMachine}</option>
              <option value="card">{t.pos.card.methodReader}</option>
              <option value="check">{t.pos.payment.methodCheck}</option>
              <option value="other">{t.pos.payment.methodOther}</option>
            </select>
          </label>
        </div>

        {isMachine ? <CardSlipFields value={slip} onChange={setSlip} /> : null}

        {isCard ? (
          <div className="rounded-md border border-warning/30 bg-warning/5 p-3 text-xs text-foreground">
            <div className="mb-1 flex items-center gap-1 font-semibold text-warning">
              <Flask size={12} weight="bold" />
              {t.pos.terminal.stubBannerTitle}
            </div>
            <p className="text-muted">{t.pos.terminal.stubBannerBody}</p>
            <label className="mt-3 block space-y-1">
              <span className="text-xs font-medium text-foreground">
                {t.pos.terminal.readerLabel}
              </span>
              <input
                type="text"
                placeholder={t.pos.payment.readerNotConnected}
                value={readerId}
                onChange={(e) => setReaderId(e.target.value)}
                className="block w-full rounded-md border border-border bg-card px-2 py-1 text-sm text-foreground focus:border-blue focus:outline-none"
              />
            </label>
          </div>
        ) : null}

        <label className="block space-y-1">
          <span className="text-sm font-medium text-foreground">
            {t.pos.payment.noteLabel}
          </span>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
          />
        </label>
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
          disabled={pending || parseFloat(amount || '0') <= 0 || (isMachine && !slipComplete(slip))}
          onClick={submit}
          className="inline-flex items-center gap-1 rounded-md bg-gold px-4 py-2 text-sm font-medium text-navy hover:bg-gold-2 disabled:opacity-50"
        >
          {isCard || isMachine ? (
            <CreditCard size={14} weight="bold" />
          ) : (
            <CashRegister size={14} weight="bold" />
          )}
          {pending
            ? t.pos.payment.submitting
            : isCard
              ? t.pos.payment.runCardPresent
              : isMachine
                ? t.pos.card.record
                : t.pos.payment.submit}
        </button>
      </Footer>
    </Modal>
  )
}
