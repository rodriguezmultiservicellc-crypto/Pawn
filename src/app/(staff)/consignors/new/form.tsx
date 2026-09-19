'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import CustomerPicker from '@/components/customers/CustomerPicker'
import { CommissionField } from '@/components/consignment/CommissionField'
import {
  createConsignorAction,
  type ConsignorFormState,
} from '../actions'

const INITIAL: ConsignorFormState = {}

export default function NewConsignorForm({
  defaultCommissionPct,
}: {
  defaultCommissionPct: number
}) {
  const { t } = useI18n()
  const tc = t.consignment
  const [state, action, pending] = useActionState<ConsignorFormState, FormData>(
    createConsignorAction,
    INITIAL,
  )

  const errorText = state.error
    ? (tc.errors as Record<string, string>)[state.error] ??
      tc.errors.consignment_failed
    : null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/consignors"
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft size={14} weight="bold" />
          {tc.detail.backToList}
        </Link>
        <h1 className="font-display text-xl font-bold">{tc.form.newTitle}</h1>
      </div>

      {errorText ? (
        <div
          className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger"
          role="alert"
        >
          {errorText}
        </div>
      ) : null}

      <form action={action} className="space-y-6">
        <fieldset className="rounded-xl border border-border bg-card p-4">
          <legend className="px-1 text-sm font-semibold text-foreground">
            {tc.form.customer}
          </legend>
          <div className="mt-2 space-y-3">
            <CustomerPicker
              name="customer_id"
              required
              initialCustomerId={state.values?.customer_id || null}
              error={
                state.fieldErrors?.customer_id
                  ? tc.errors.customer_not_found
                  : undefined
              }
            />
            <p className="text-xs text-muted">{tc.form.customerHelp}</p>
          </div>
        </fieldset>

        <fieldset className="rounded-xl border border-border bg-card p-4">
          <legend className="px-1 text-sm font-semibold text-foreground">
            {tc.form.editTitle}
          </legend>
          <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">
                {tc.form.businessName}
              </span>
              <input
                type="text"
                name="business_name"
                defaultValue={state.values?.business_name ?? ''}
                className="block w-full rounded-md border border-border bg-card px-3 py-2 text-foreground focus:border-blue focus:outline-none"
              />
            </label>

            <CommissionField
              name="default_commission_pct"
              label={tc.form.commission}
              help={tc.form.commissionHelp}
              defaultFraction={defaultCommissionPct}
            />

            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">
                {tc.form.payoutMethod}
              </span>
              <select
                name="default_payout_method"
                defaultValue={state.values?.default_payout_method || 'cash'}
                className="block w-full rounded-md border border-border bg-card px-3 py-2 text-foreground focus:border-blue focus:outline-none"
              >
                <option value="cash">{t.pos.payment.methodCash}</option>
                <option value="check">{t.pos.payment.methodCheck}</option>
                <option value="card">{t.pos.payment.methodCard}</option>
                <option value="other">{t.pos.payment.methodOther}</option>
              </select>
            </label>

            <label className="block space-y-1 md:col-span-2">
              <span className="text-sm font-medium text-foreground">
                {tc.form.notes}
              </span>
              <textarea
                name="notes"
                rows={3}
                defaultValue={state.values?.notes ?? ''}
                className="block w-full rounded-md border border-border bg-card px-3 py-2 text-foreground focus:border-blue focus:outline-none"
              />
            </label>
          </div>
        </fieldset>

        <div className="flex items-center justify-end gap-3">
          <Link
            href="/consignors"
            className="rounded-md border border-border px-4 py-2 text-sm text-foreground"
          >
            {t.common.cancel}
          </Link>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-gold px-4 py-2 text-sm font-medium text-navy hover:bg-gold-2 disabled:opacity-50"
          >
            {pending ? tc.form.creating : tc.form.create}
          </button>
        </div>
      </form>
    </div>
  )
}
