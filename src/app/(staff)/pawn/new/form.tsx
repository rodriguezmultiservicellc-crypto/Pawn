'use client'

import { useActionState, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Upload } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { addDaysIso, todayDateString } from '@/lib/pawn/math'
import { CollateralItemsList } from '@/components/pawn/CollateralItemsList'
import {
  createLoanAction,
  type CreateLoanState,
} from './actions'

export type CustomerOption = {
  id: string
  label: string
}

export default function NewPawnLoanForm({
  customers,
}: {
  customers: CustomerOption[]
}) {
  const { t } = useI18n()
  const [state, formAction, pending] = useActionState<
    CreateLoanState,
    FormData
  >(createLoanAction, {})

  const today = todayDateString()
  const [issueDate, setIssueDate] = useState<string>(today)
  const [termDays, setTermDays] = useState<string>('30')
  const [customerId, setCustomerId] = useState<string>('')

  const computedDueDate = useMemo(() => {
    const days = parseInt(termDays || '0', 10)
    if (!isFinite(days) || days <= 0) return ''
    return addDaysIso(issueDate || today, days)
  }, [issueDate, termDays, today])

  const sigInputRef = useRef<HTMLInputElement>(null)
  const [sigPreview, setSigPreview] = useState<string | null>(null)

  function onSigChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) {
      setSigPreview(null)
      return
    }
    setSigPreview(file.name)
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t.pawn.new_.title}</h1>
        <Link href="/pawn" className="text-sm text-ash hover:text-ink">
          {t.pawn.backToList}
        </Link>
      </div>

      {state.error ? (
        <div className="rounded-md border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">
          {state.error}
        </div>
      ) : null}

      <form action={formAction} className="space-y-6">
        {/* Customer */}
        <fieldset className="rounded-lg border border-hairline bg-canvas p-4">
          <legend className="px-1 text-sm font-semibold text-ink">
            {t.pawn.new_.sectionCustomer}
          </legend>
          <p className="mt-1 text-xs text-ash">
            {t.pawn.new_.pickCustomerHelp}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <select
              name="customer_id"
              required
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="flex-1 rounded-md border border-hairline bg-canvas px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
            >
              <option value="">{t.pawn.new_.pickCustomer}</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <Link
              href="/customers/new?return=/pawn/new"
              className="rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink hover:border-ink"
            >
              {t.pawn.new_.newCustomer}
            </Link>
          </div>
          {state.fieldErrors?.customer_id ? (
            <div className="mt-1 text-xs text-error">
              {state.fieldErrors.customer_id}
            </div>
          ) : null}
        </fieldset>

        {/* Terms */}
        <fieldset className="rounded-lg border border-hairline bg-canvas p-4">
          <legend className="px-1 text-sm font-semibold text-ink">
            {t.pawn.new_.sectionTerms}
          </legend>
          <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-3">
            <label className="block space-y-1">
              <span className="text-sm font-medium text-ink">
                {t.pawn.new_.principal} *
              </span>
              <input
                type="number"
                step="0.01"
                min={0.01}
                name="principal"
                required
                placeholder="0.00"
                className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
              />
              {state.fieldErrors?.principal ? (
                <span className="text-xs text-error">
                  {state.fieldErrors.principal}
                </span>
              ) : null}
            </label>

            <label className="block space-y-1">
              <span className="text-sm font-medium text-ink">
                {t.pawn.new_.interestRate} *
              </span>
              <input
                type="number"
                step="0.0001"
                min={0}
                max={0.25}
                name="interest_rate_monthly"
                required
                defaultValue="0.10"
                className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
              />
              <span className="text-xs text-ash">
                {t.pawn.new_.interestRateHelp}
              </span>
            </label>

            <label className="block space-y-1">
              <span className="text-sm font-medium text-ink">
                {t.pawn.new_.termDays} *
              </span>
              <input
                type="number"
                min={1}
                max={180}
                name="term_days"
                required
                value={termDays}
                onChange={(e) => setTermDays(e.target.value)}
                className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-sm font-medium text-ink">
                {t.pawn.new_.issueDate}
              </span>
              <input
                type="date"
                name="issue_date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
                className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
              />
            </label>

            <label className="block space-y-1 md:col-span-2">
              <span className="text-sm font-medium text-ink">
                {t.pawn.new_.dueDate}{' '}
                <span className="text-xs text-ash">
                  {t.pawn.new_.dueDateAuto}
                </span>
              </span>
              <input
                type="date"
                name="due_date"
                value={computedDueDate}
                onChange={() => {
                  /* allow override but the auto value tracks term/issue */
                }}
                readOnly
                className="block w-full rounded-md border border-hairline bg-cloud/50 px-3 py-2 text-ash"
              />
            </label>
          </div>
        </fieldset>

        {/* Collateral */}
        <fieldset className="rounded-lg border border-hairline bg-canvas p-4">
          <legend className="px-1 text-sm font-semibold text-ink">
            {t.pawn.new_.sectionCollateral}
          </legend>
          <p className="mt-1 text-xs text-ash">{t.pawn.new_.itemMinOne}</p>
          <div className="mt-2">
            <CollateralItemsList />
          </div>
        </fieldset>

        {/* Signature & notes */}
        <fieldset className="rounded-lg border border-hairline bg-canvas p-4">
          <legend className="px-1 text-sm font-semibold text-ink">
            {t.pawn.new_.sectionSignature}
          </legend>
          <div className="mt-2 space-y-3">
            <div>
              <span className="block text-sm font-medium text-ink">
                {t.pawn.new_.signature}
              </span>
              <p className="mb-1 text-xs text-ash">
                {t.pawn.new_.signatureHelp}
              </p>
              <button
                type="button"
                onClick={() => sigInputRef.current?.click()}
                className="inline-flex items-center gap-1 rounded-md border border-dashed border-hairline bg-canvas px-3 py-2 text-sm font-medium text-ink hover:border-ink"
              >
                <Upload size={14} weight="bold" />
                {sigPreview ?? t.common.upload}
              </button>
              <input
                ref={sigInputRef}
                type="file"
                name="signature_file"
                accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
                onChange={onSigChange}
                className="sr-only"
              />
            </div>

            <label className="block space-y-1">
              <span className="text-sm font-medium text-ink">
                {t.pawn.new_.notes}
              </span>
              <textarea
                name="notes"
                rows={2}
                className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
              />
            </label>
          </div>
        </fieldset>

        <div className="flex items-center justify-end gap-3">
          <Link
            href="/pawn"
            className="rounded-md border border-hairline px-4 py-2 text-sm text-ink"
          >
            {t.common.cancel}
          </Link>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-rausch px-4 py-2 text-canvas font-medium hover:bg-rausch-deep disabled:opacity-50"
          >
            {pending ? t.pawn.new_.submitting : t.pawn.new_.submit}
          </button>
        </div>
      </form>
    </div>
  )
}
