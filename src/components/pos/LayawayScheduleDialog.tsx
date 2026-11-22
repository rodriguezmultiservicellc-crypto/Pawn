'use client'

import { useState, useTransition } from 'react'
import { Calendar, ShoppingBag } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { formatCalendarDate } from '@/lib/format/date'
import { todayInTimezone } from '@/lib/jurisdictions/rules'
import { fractionToPercent } from '@/lib/format/money'
import {
  applyLayawayTerm,
  initialLayawayTerm,
  type LayawayTerm,
} from '@/lib/pos/layaway-terms'
import type { LayawayScheduleKind, PaymentMethod } from '@/types/database-aliases'
import { Modal, Footer } from './Modal'

export type LayawayScheduleSubmit = {
  schedule_kind: LayawayScheduleKind
  down_payment: string
  down_payment_method: PaymentMethod
  first_payment_due: string
  final_due_date: string
  cancellation_fee_pct: string
  /** The saved terms the clerk picked; null when typed by hand ("Custom"). */
  layaway_term_id: string | null
}

const CUSTOM = 'custom'

const fieldCls =
  'block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue'
const labelCls = 'text-sm font-medium text-foreground'

/**
 * Opens a layaway for the cart. The shop's saved terms (Settings → Layaway
 * terms) fill the schedule, dates, fee and minimum down payment; the default
 * one is picked when the dialog opens. "Custom" shows every field for the
 * clerk to type, as before.
 */
export function LayawayScheduleDialog({
  total,
  terms,
  canEditTerms,
  timezone,
  onClose,
  onSubmit,
}: {
  total: number
  /** Active saved terms, in list order. Empty = the shop has none yet. */
  terms: LayawayTerm[]
  canEditTerms: boolean
  /** The shop's timezone — due dates count from the shop's "today". */
  timezone: string
  onClose: () => void
  onSubmit: (
    payload: LayawayScheduleSubmit,
  ) => Promise<{ error?: string; ok?: boolean }>
}) {
  const { t, lang } = useI18n()
  const lt = t.layawayTerms.dialog
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  // The dialog mounts on a click, so reading the clock here is safe.
  const [today] = useState(() => todayInTimezone(timezone))
  const applied = (term: LayawayTerm) => applyLayawayTerm(term, total, today)

  const [choice, setChoice] = useState<string>(() => initialLayawayTerm(terms)?.id ?? CUSTOM)
  const [scheduleKind, setScheduleKind] =
    useState<LayawayScheduleKind>('weekly')
  const [downPayment, setDownPayment] = useState<string>(() => {
    const first = initialLayawayTerm(terms)
    return first ? applied(first).down_payment_min.toFixed(2) : '0'
  })
  const [downPaymentMethod, setDownPaymentMethod] =
    useState<PaymentMethod>('cash')
  const [firstPaymentDue, setFirstPaymentDue] = useState<string>('')
  const [finalDueDate, setFinalDueDate] = useState<string>('')
  const [cancellationFeePct, setCancellationFeePct] = useState<string>('0.10')

  // What "Open layaway" will collect now — shown on the button itself, read
  // from the same value that is sent, so the clerk sees the exact amount.
  const downNow = Number.parseFloat(downPayment || '0')
  const picked = terms.find((term) => term.id === choice) ?? null
  const plan = picked ? applied(picked) : null

  function pick(id: string) {
    setError(null)
    setChoice(id)
    const term = terms.find((x) => x.id === id)
    // Picking saved terms sets the down payment to what they ask for; going
    // to Custom keeps whatever is typed.
    if (term) setDownPayment(applied(term).down_payment_min.toFixed(2))
  }

  function submit() {
    setError(null)
    if (plan && picked) {
      if (!Number.isFinite(downNow) || downNow + 0.005 < plan.down_payment_min) {
        setError(lt.downPaymentTooLow.replace('{amount}', fmtMoney(plan.down_payment_min)))
        return
      }
    }
    startTransition(async () => {
      const res = await onSubmit(
        plan && picked
          ? {
              schedule_kind: plan.schedule_kind,
              down_payment: downPayment,
              down_payment_method: downPaymentMethod,
              first_payment_due: plan.first_payment_due,
              final_due_date: plan.final_due_date,
              cancellation_fee_pct: String(plan.cancellation_fee_pct),
              layaway_term_id: picked.id,
            }
          : {
              schedule_kind: scheduleKind,
              down_payment: downPayment,
              down_payment_method: downPaymentMethod,
              first_payment_due: firstPaymentDue,
              final_due_date: finalDueDate,
              cancellation_fee_pct: cancellationFeePct,
              layaway_term_id: null,
            },
      )
      if (res.error) setError(res.error)
      else onClose()
    })
  }

  const scheduleLabel: Record<LayawayScheduleKind, string> = {
    weekly: t.pos.layaway.scheduleWeekly,
    biweekly: t.pos.layaway.scheduleBiweekly,
    monthly: t.pos.layaway.scheduleMonthly,
    custom: t.pos.layaway.scheduleCustom,
  }

  const editTermsLink = canEditTerms ? (
    // New tab: leaving this page would empty the cart.
    <a
      href="/settings/layaway-terms"
      target="_blank"
      rel="noopener"
      className="text-xs font-medium text-blue hover:text-blue-2"
    >
      {lt.manage}
    </a>
  ) : null

  return (
    <Modal title={t.pos.layaway.new} onClose={onClose} size="lg">
      {error ? (
        <div
          role="alert"
          className="mb-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger"
        >
          {error}
        </div>
      ) : null}

      <div className="space-y-4">
        <div className="rounded-md border border-border bg-background/40 p-3 text-sm text-foreground">
          <div className="flex items-center gap-2">
            <ShoppingBag size={14} weight="bold" />
            <span className="font-medium">{t.pos.sale.total}:</span>
            <span className="font-mono">{fmtMoney(total)}</span>
          </div>
          <p className="mt-1 text-xs text-muted">
            {t.pos.layaway.itemsHeldHelp}
          </p>
        </div>

        {terms.length > 0 ? (
          <label className="block space-y-1">
            <span className="flex items-center justify-between gap-3">
              <span className={labelCls}>{lt.terms}</span>
              {editTermsLink}
            </span>
            <select
              value={choice}
              onChange={(e) => pick(e.target.value)}
              className={fieldCls}
            >
              {terms.map((term) => (
                <option key={term.id} value={term.id}>
                  {term.is_default ? lt.defaultMark.replace('{name}', term.name) : term.name}
                </option>
              ))}
              <option value={CUSTOM}>{lt.custom}</option>
            </select>
          </label>
        ) : canEditTerms ? (
          <p className="text-xs text-muted">
            {lt.noTermsHint} {editTermsLink}
          </p>
        ) : null}

        {plan ? (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-3 rounded-md border border-border bg-background/40 p-3 text-sm">
            <div>
              <dt className="text-xs text-muted">{t.pos.layaway.schedule}</dt>
              <dd className="font-medium text-foreground">{scheduleLabel[plan.schedule_kind]}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">{lt.cancellationFee}</dt>
              <dd className="font-mono font-medium text-foreground">
                {fractionToPercent(plan.cancellation_fee_pct)}%
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">{t.pos.layaway.firstPaymentDue}</dt>
              <dd className="font-medium text-foreground">
                {formatCalendarDate(plan.first_payment_due, lang)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">{t.pos.layaway.finalDue}</dt>
              <dd className="font-medium text-foreground">
                {formatCalendarDate(plan.final_due_date, lang)}
              </dd>
            </div>
          </dl>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className={labelCls}>{t.pos.layaway.schedule}</span>
                <select
                  value={scheduleKind}
                  onChange={(e) =>
                    setScheduleKind(e.target.value as LayawayScheduleKind)
                  }
                  className={fieldCls}
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
                <span className={labelCls}>
                  {t.pos.layaway.cancellationFeePct}
                </span>
                <input
                  type="number"
                  step="0.0001"
                  min={0}
                  max={1}
                  value={cancellationFeePct}
                  onChange={(e) => setCancellationFeePct(e.target.value)}
                  className={fieldCls}
                />
                <span className="block text-xs text-muted">
                  {t.pos.layaway.cancellationFeeHelp}
                </span>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className={labelCls}>
                  {t.pos.layaway.firstPaymentDue}
                </span>
                <input
                  type="date"
                  value={firstPaymentDue}
                  onChange={(e) => setFirstPaymentDue(e.target.value)}
                  className={fieldCls}
                />
              </label>
              <label className="block space-y-1">
                <span className={labelCls}>{t.pos.layaway.finalDue}</span>
                <input
                  type="date"
                  value={finalDueDate}
                  onChange={(e) => setFinalDueDate(e.target.value)}
                  className={fieldCls}
                />
              </label>
            </div>
          </>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className={labelCls}>{t.pos.layaway.downPayment}</span>
            <input
              type="number"
              step="0.01"
              min={plan ? plan.down_payment_min : 0}
              value={downPayment}
              onChange={(e) => setDownPayment(e.target.value)}
              className={fieldCls}
            />
            {plan && plan.down_payment_min > 0 ? (
              <span className="block text-xs text-muted">
                {lt.downPaymentMin.replace('{amount}', fmtMoney(plan.down_payment_min))}
              </span>
            ) : null}
          </label>
          <label className="block space-y-1">
            <span className={labelCls}>
              {t.pos.layaway.downPaymentMethod}
            </span>
            <select
              value={downPaymentMethod}
              onChange={(e) =>
                setDownPaymentMethod(e.target.value as PaymentMethod)
              }
              className={fieldCls}
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
          className="rounded-md border border-border bg-card px-4 py-2 text-sm text-foreground hover:bg-background hover:text-foreground"
        >
          {t.common.cancel}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={submit}
          className="inline-flex items-center gap-1 rounded-md bg-gold px-4 py-2 text-sm font-medium text-navy hover:bg-gold-2 disabled:opacity-50"
        >
          <Calendar size={14} weight="bold" />
          {pending
            ? t.pos.layaway.submitCreating
            : Number.isFinite(downNow) && downNow > 0
              ? lt.submitWithDown.replace('{amount}', fmtMoney(downNow))
              : lt.submitNoDown}
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
