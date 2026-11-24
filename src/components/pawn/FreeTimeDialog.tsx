'use client'

import { useMemo, useState, useTransition } from 'react'
import { CalendarCheck, Gift } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { MAX_FREE_DAYS, planFreeTime, type ChargeModel } from '@/lib/pawn/math'
import { Modal, Footer } from './RecordPaymentDialog'

/**
 * A manager gives a customer free time on a ticket: the due date moves, from
 * the CURRENT due date, and the interest for those days is not charged. No
 * money changes hands.
 *
 * Managers only — the button is hidden from everyone else and the server
 * action checks the role itself. The figures here are a preview of
 * `planFreeTime`, the same function the server runs.
 */
export function FreeTimeDialog({
  loanId,
  loan,
  onClose,
  onSubmit,
}: {
  loanId: string
  loan: {
    principal: number
    monthlyRate: number
    minMonthlyCharge: number | null
    dueDate: string
    charge: ChargeModel
  }
  onClose: () => void
  onSubmit: (
    formData: FormData,
  ) => Promise<{ error?: string; ok?: boolean }>
}) {
  const { t } = useI18n()
  const tf = t.pawn.freeTime
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [quantityStr, setQuantityStr] = useState<string>('1')
  const [unit, setUnit] = useState<'periods' | 'days'>('periods')
  const [notes, setNotes] = useState<string>('')

  const periodDays = loan.charge.periodDays
  const quantity = parseInt(quantityStr || '0', 10) || 0
  const days = unit === 'periods' ? quantity * periodDays : quantity
  const plan = useMemo(() => planFreeTime(loan, days), [loan, days])
  const tooLong = days > MAX_FREE_DAYS

  function translateError(code: string): string {
    const known = tf.errors as Record<string, string>
    return (known[code] ?? known.generic).replace('{max}', String(MAX_FREE_DAYS))
  }

  function submit() {
    setError(null)
    const fd = new FormData()
    fd.set('loan_id', loanId)
    fd.set('quantity', String(quantity))
    fd.set('unit', unit)
    if (notes) fd.set('notes', notes)
    startTransition(async () => {
      const res = await onSubmit(fd)
      if (res.error) setError(translateError(res.error))
      else onClose()
    })
  }

  const INPUT =
    'block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue'
  const usd = (n: number) =>
    n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })

  return (
    <Modal title={tf.title} onClose={onClose}>
      {error ? (
        <div className="mb-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}

      <div className="space-y-4">
        <p className="text-sm text-text-secondary">{tf.help}</p>

        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-sm font-medium text-foreground">{tf.quantity}</span>
            <input
              type="number"
              min={1}
              step={1}
              value={quantityStr}
              onChange={(e) => setQuantityStr(e.target.value)}
              className={INPUT}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-foreground">{tf.unit}</span>
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value === 'days' ? 'days' : 'periods')}
              className={INPUT}
            >
              <option value="periods">
                {tf.unitPeriods.replace('{days}', String(periodDays))}
              </option>
              <option value="days">{tf.unitDays}</option>
            </select>
          </label>
        </div>

        {plan ? (
          <div className="space-y-1 rounded-md border border-border bg-background/40 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2 text-foreground">
              <CalendarCheck size={14} weight="bold" />
              <span className="font-medium">{tf.newDueDate}:</span>
              <span className="font-mono">{plan.new_due_date}</span>
              <span className="text-xs text-muted">
                {tf.dueWas.replace('{date}', loan.dueDate)}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-foreground">
              <Gift size={14} weight="bold" />
              <span className="font-medium">{tf.waived}:</span>
              <span className="font-mono">{usd(plan.interest_waived)}</span>
            </div>
          </div>
        ) : tooLong ? (
          <p className="text-xs text-danger">{translateError('too_long')}</p>
        ) : null}

        <label className="block space-y-1">
          <span className="text-sm font-medium text-foreground">{tf.reason}</span>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={INPUT}
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
          disabled={pending || !plan}
          onClick={submit}
          className="inline-flex items-center gap-1 rounded-md bg-gold px-4 py-2 text-sm font-medium text-navy hover:bg-gold-2 disabled:opacity-50"
        >
          <Gift size={14} weight="bold" />
          {pending ? tf.submitting : tf.submit}
        </button>
      </Footer>
    </Modal>
  )
}
