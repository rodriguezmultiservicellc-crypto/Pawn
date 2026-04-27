'use client'

import { useState, useTransition } from 'react'
import { Calendar, ShoppingBag } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import type { LayawayScheduleKind, PaymentMethod } from '@/types/database-aliases'
import { Modal, Footer } from './Modal'

export type LayawayScheduleSubmit = {
  schedule_kind: LayawayScheduleKind
  down_payment: string
  down_payment_method: PaymentMethod
  first_payment_due: string
  final_due_date: string
  cancellation_fee_pct: string
}

export function LayawayScheduleDialog({
  total,
  onClose,
  onSubmit,
}: {
  total: number
  onClose: () => void
  onSubmit: (
    payload: LayawayScheduleSubmit,
  ) => Promise<{ error?: string; ok?: boolean }>
}) {
  const { t } = useI18n()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [scheduleKind, setScheduleKind] =
    useState<LayawayScheduleKind>('weekly')
  const [downPayment, setDownPayment] = useState<string>('0')
  const [downPaymentMethod, setDownPaymentMethod] =
    useState<PaymentMethod>('cash')
  const [firstPaymentDue, setFirstPaymentDue] = useState<string>('')
  const [finalDueDate, setFinalDueDate] = useState<string>('')
  const [cancellationFeePct, setCancellationFeePct] = useState<string>('0.10')

  function submit() {
    setError(null)
    startTransition(async () => {
      const res = await onSubmit({
        schedule_kind: scheduleKind,
        down_payment: downPayment,
        down_payment_method: downPaymentMethod,
        first_payment_due: firstPaymentDue,
        final_due_date: finalDueDate,
        cancellation_fee_pct: cancellationFeePct,
      })
      if (res.error) setError(res.error)
      else onClose()
    })
  }

  return (
    <Modal title={t.pos.layaway.new} onClose={onClose} size="lg">
      {error ? (
        <div className="mb-3 rounded-md border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">
          {error}
        </div>
      ) : null}

      <div className="space-y-4">
        <div className="rounded-md border border-hairline bg-cloud/40 p-3 text-sm text-ink">
          <div className="flex items-center gap-2">
            <ShoppingBag size={14} weight="bold" />
            <span className="font-medium">{t.pos.sale.total}:</span>
            <span className="font-mono">{fmtMoney(total)}</span>
          </div>
          <p className="mt-1 text-xs text-ash">
            {t.pos.layaway.itemsHeldHelp}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-sm font-medium text-ink">
              {t.pos.layaway.schedule}
            </span>
            <select
              value={scheduleKind}
              onChange={(e) =>
                setScheduleKind(e.target.value as LayawayScheduleKind)
              }
              className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
            >
              <option value="weekly">{t.pos.layaway.scheduleWeekly}</option>
              <option value="biweekly">
                {t.pos.layaway.scheduleBiweekly}
              </option>
              <option value="monthly">{t.pos.layaway.scheduleMonthly}</option>
              <option value="custom">{t.pos.layaway.scheduleCustom}</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-ink">
              {t.pos.layaway.cancellationFeePct}
            </span>
            <input
              type="number"
              step="0.0001"
              min={0}
              max={1}
              value={cancellationFeePct}
              onChange={(e) => setCancellationFeePct(e.target.value)}
              className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
            />
            <span className="block text-xs text-ash">
              {t.pos.layaway.cancellationFeeHelp}
            </span>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-sm font-medium text-ink">
              {t.pos.layaway.firstPaymentDue}
            </span>
            <input
              type="date"
              value={firstPaymentDue}
              onChange={(e) => setFirstPaymentDue(e.target.value)}
              className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-ink">
              {t.pos.layaway.finalDue}
            </span>
            <input
              type="date"
              value={finalDueDate}
              onChange={(e) => setFinalDueDate(e.target.value)}
              className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-sm font-medium text-ink">
              {t.pos.layaway.downPayment}
            </span>
            <input
              type="number"
              step="0.01"
              min={0}
              value={downPayment}
              onChange={(e) => setDownPayment(e.target.value)}
              className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-ink">
              {t.pos.layaway.downPaymentMethod}
            </span>
            <select
              value={downPaymentMethod}
              onChange={(e) =>
                setDownPaymentMethod(e.target.value as PaymentMethod)
              }
              className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
            >
              <option value="cash">{t.pos.payment.methodCash}</option>
              <option value="card">{t.pos.payment.methodCard}</option>
              <option value="check">{t.pos.payment.methodCheck}</option>
              <option value="other">{t.pos.payment.methodOther}</option>
            </select>
          </label>
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
          disabled={pending}
          onClick={submit}
          className="inline-flex items-center gap-1 rounded-md bg-rausch px-4 py-2 text-sm font-medium text-canvas hover:bg-rausch-deep disabled:opacity-50"
        >
          <Calendar size={14} weight="bold" />
          {pending
            ? t.pos.layaway.submitCreating
            : t.pos.layaway.submitCreate}
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
