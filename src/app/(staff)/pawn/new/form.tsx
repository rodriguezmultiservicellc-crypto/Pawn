'use client'

import { useActionState, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Upload } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { addDaysIso, todayDateString } from '@/lib/pawn/math'
import {
  CollateralItemsList,
  type CollateralListHandle,
} from '@/components/pawn/CollateralItemsList'
import { InlinePawnCalculator } from '@/components/pawn/InlinePawnCalculator'
import VoicePawnButton, {
  type PawnVoiceData,
} from '@/components/pawn/VoicePawnButton'
import {
  createLoanAction,
  type CreateLoanState,
} from './actions'

const PAWN_NEW_FORM_ID = 'pawn-new-form'

export type CustomerOption = {
  id: string
  label: string
}

export type LoanRateOption = {
  id: string
  rateMonthly: number
  /** Per-rate floor on monthly interest. Null = no floor. */
  minMonthlyCharge: number | null
  label: string
  description: string | null
  isDefault: boolean
}

const CUSTOM_RATE_VALUE = '__custom__'

export default function NewPawnLoanForm({
  customers,
  rates,
  minLoanAmount,
}: {
  customers: CustomerOption[]
  rates: LoanRateOption[]
  /** Tenant-wide min loan principal. Null = no minimum. */
  minLoanAmount: number | null
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
  // Customer dropdown options are lifted so /api/ai/voice/pawn-intake
  // can inject a freshly-created customer (match-or-create branch)
  // without a full page reload — the new option is appended at the
  // top so it's visible above the alphabetical list.
  const [customerOptions, setCustomerOptions] =
    useState<CustomerOption[]>(customers)
  // Principal is controlled so voice intake can pre-fill it. The
  // server action reads `principal` off FormData on submit, so the
  // controlled <input> still serializes correctly.
  const [principal, setPrincipal] = useState<string>('')

  // Default rate selection: the configured default rate, OR the first
  // active rate, OR the literal "custom" sentinel when no rates exist
  // (graceful fallback so the form still works on a brand-new tenant
  // before any rates are configured).
  const defaultRateId =
    rates.find((r) => r.isDefault)?.id ?? rates[0]?.id ?? CUSTOM_RATE_VALUE
  const [rateChoice, setRateChoice] = useState<string>(defaultRateId)

  // The actual rate value submitted to the server. Picked from the menu
  // for preset choices, or typed manually when the operator picks
  // Custom. Defaults to 0.10 to match the legacy behavior.
  const initialCustomRate =
    (rates.find((r) => r.isDefault) ?? rates[0])?.rateMonthly?.toString() ??
    '0.10'
  const [customRate, setCustomRate] = useState<string>(initialCustomRate)
  const isCustomRate = rateChoice === CUSTOM_RATE_VALUE
  const selectedRate = isCustomRate
    ? null
    : (rates.find((r) => r.id === rateChoice) ?? null)
  const submittedRate = isCustomRate
    ? customRate
    : (selectedRate?.rateMonthly?.toString() ?? customRate)
  // Custom rate has no min by definition. Snapshot the preset rate's
  // min_monthly_charge to the hidden field so the server can write it
  // onto loans.min_monthly_charge.
  const submittedMinCharge =
    selectedRate?.minMonthlyCharge != null
      ? selectedRate.minMonthlyCharge.toString()
      : ''

  const selectedRateDescription = selectedRate?.description ?? null

  const computedDueDate = useMemo(() => {
    const days = parseInt(termDays || '0', 10)
    if (!isFinite(days) || days <= 0) return ''
    return addDaysIso(issueDate || today, days)
  }, [issueDate, termDays, today])

  const sigInputRef = useRef<HTMLInputElement>(null)
  const [sigPreview, setSigPreview] = useState<string | null>(null)

  // Ref into CollateralItemsList exposes addWatchRow(match), letting the
  // inline calculator's watch typeahead append a populated collateral
  // row when the operator picks a model. Imperative handle pattern
  // keeps row state in the list (not lifted) so existing keystrokes
  // don't re-render the parent.
  const collateralRef = useRef<CollateralListHandle>(null)

  function onSigChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) {
      setSigPreview(null)
      return
    }
    setSigPreview(file.name)
  }

  // Voice intake fills three things: customer (match-or-create on the
  // server returns the resolved id + label), principal, and one
  // collateral row pushed via the imperative handle. Term/rate are
  // intentionally NOT touched — operator picks those, voice only
  // covers the high-frequency intake fields.
  function handleVoiceData(data: PawnVoiceData) {
    if (data.customer) {
      const next: CustomerOption = {
        id: data.customer.id,
        label: data.customer.label,
      }
      if (data.customer.isNew) {
        setCustomerOptions((prev) =>
          prev.some((c) => c.id === next.id) ? prev : [next, ...prev],
        )
      } else if (!customerOptions.some((c) => c.id === next.id)) {
        // Existing customer outside the first-500 page — inject so the
        // dropdown can render the selection.
        setCustomerOptions((prev) => [next, ...prev])
      }
      setCustomerId(data.customer.id)
    }
    if (data.principal != null) {
      setPrincipal(data.principal.toString())
    }
    if (data.collateral) {
      collateralRef.current?.addExtractedRow(data.collateral)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold">{t.pawn.new_.title}</h1>
        <Link href="/pawn" className="text-sm text-muted hover:text-foreground">
          {t.pawn.backToList}
        </Link>
      </div>

      <VoicePawnButton onDataExtracted={handleVoiceData} />

      {state.error ? (
        <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {state.error}
        </div>
      ) : state.fieldErrors && Object.keys(state.fieldErrors).length > 0 ? (
        <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {t.common.fixErrorsBelow}
        </div>
      ) : null}

      <form
        id={PAWN_NEW_FORM_ID}
        action={formAction}
        className="space-y-6"
      >
        {/* Customer */}
        <fieldset className="rounded-xl border border-border bg-card p-4">
          <legend className="px-1 text-sm font-semibold text-foreground">
            {t.pawn.new_.sectionCustomer}
          </legend>
          <p className="mt-1 text-xs text-muted">
            {t.pawn.new_.pickCustomerHelp}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <select
              name="customer_id"
              required
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="flex-1 rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
            >
              <option value="">{t.pawn.new_.pickCustomer}</option>
              {customerOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <Link
              href="/customers/new?return=/pawn/new"
              className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-background hover:text-foreground"
            >
              {t.pawn.new_.newCustomer}
            </Link>
          </div>
          {state.fieldErrors?.customer_id ? (
            <div className="mt-1 text-xs text-danger">
              {state.fieldErrors.customer_id}
            </div>
          ) : null}
        </fieldset>

        {/* Terms */}
        <fieldset className="rounded-xl border border-border bg-card p-4">
          <legend className="px-1 text-sm font-semibold text-foreground">
            {t.pawn.new_.sectionTerms}
          </legend>
          <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-3">
            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">
                {t.pawn.new_.principal} *
              </span>
              <input
                type="number"
                step="0.01"
                min={minLoanAmount ?? 0.01}
                name="principal"
                required
                placeholder="0.00"
                value={principal}
                onChange={(e) => setPrincipal(e.target.value)}
                className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
              />
              {minLoanAmount != null ? (
                <span className="block text-xs text-muted">
                  {t.pawn.new_.principalMinHint.replace(
                    '{amount}',
                    `$${minLoanAmount.toFixed(2)}`,
                  )}
                </span>
              ) : null}
              {state.fieldErrors?.principal ? (
                <span className="text-xs text-danger">
                  {state.fieldErrors.principal}
                </span>
              ) : null}
            </label>

            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">
                {t.pawn.new_.interestRate} *
              </span>
              {/* Hidden field carries the actual rate value submitted
                  to the server. The visible <select> chooses preset OR
                  custom; the custom path swaps in a number input. */}
              <input
                type="hidden"
                name="interest_rate_monthly"
                value={submittedRate}
              />
              {/* Snapshot of the selected rate's per-month minimum (empty
                  when the operator picked Custom or the rate has no
                  floor). The server reads this onto loans.min_monthly_charge. */}
              <input
                type="hidden"
                name="min_monthly_charge"
                value={submittedMinCharge}
              />
              {rates.length > 0 ? (
                <select
                  value={rateChoice}
                  onChange={(e) => setRateChoice(e.target.value)}
                  className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
                >
                  {rates.map((r) => (
                    <option key={r.id} value={r.id}>
                      {(r.rateMonthly * 100).toFixed(2)}% — {r.label}
                      {r.minMonthlyCharge != null
                        ? ` (${t.pawn.new_.rateMinSuffix.replace(
                            '{amount}',
                            `$${r.minMonthlyCharge.toFixed(2)}`,
                          )})`
                        : ''}
                      {r.isDefault ? ` (${t.pawn.new_.rateDefaultBadge})` : ''}
                    </option>
                  ))}
                  <option value={CUSTOM_RATE_VALUE}>
                    {t.pawn.new_.rateCustom}
                  </option>
                </select>
              ) : null}
              {isCustomRate ? (
                <input
                  type="number"
                  step="0.0001"
                  min={0}
                  max={0.25}
                  value={customRate}
                  onChange={(e) => setCustomRate(e.target.value)}
                  required
                  className="mt-2 block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
                />
              ) : null}
              {selectedRateDescription ? (
                <span className="block text-xs text-muted">
                  {selectedRateDescription}
                </span>
              ) : (
                <span className="block text-xs text-muted">
                  {t.pawn.new_.interestRateHelp}
                </span>
              )}
              {rates.length === 0 ? (
                <span className="block text-xs text-muted">
                  {t.pawn.new_.rateNoneConfigured}
                </span>
              ) : null}
            </label>

            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">
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
                className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">
                {t.pawn.new_.issueDate}
              </span>
              <input
                type="date"
                name="issue_date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
                className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
              />
            </label>

            <label className="block space-y-1 md:col-span-2">
              <span className="text-sm font-medium text-foreground">
                {t.pawn.new_.dueDate}{' '}
                <span className="text-xs text-muted">
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
                className="block w-full rounded-md border border-border bg-background/50 px-3 py-2 text-muted"
              />
            </label>
          </div>
        </fieldset>

        {/* Collateral */}
        <fieldset className="rounded-xl border border-border bg-card p-4">
          <legend className="px-1 text-sm font-semibold text-foreground">
            {t.pawn.new_.sectionCollateral}
          </legend>
          <p className="mt-1 text-xs text-muted">{t.pawn.new_.itemMinOne}</p>
          <div className="mt-2">
            <CollateralItemsList ref={collateralRef} />
          </div>
        </fieldset>

        {/* Inline calculator — reads collateral_<n>_* from this form via
            DOM access; writes back to the principal field on click.
            onAddWatchToCollateral pushes the picked watch into the
            collateral list as a populated row (description + est_value
            from the typeahead match midpoint). */}
        <InlinePawnCalculator
          formId={PAWN_NEW_FORM_ID}
          onAddWatchToCollateral={(match) =>
            collateralRef.current?.addWatchRow(match)
          }
        />

        {/* Signature & notes */}
        <fieldset className="rounded-xl border border-border bg-card p-4">
          <legend className="px-1 text-sm font-semibold text-foreground">
            {t.pawn.new_.sectionSignature}
          </legend>
          <div className="mt-2 space-y-3">
            <div>
              <span className="block text-sm font-medium text-foreground">
                {t.pawn.new_.signature}
              </span>
              <p className="mb-1 text-xs text-muted">
                {t.pawn.new_.signatureHelp}
              </p>
              <button
                type="button"
                onClick={() => sigInputRef.current?.click()}
                className="inline-flex items-center gap-1 rounded-md border border-dashed border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-background hover:text-foreground"
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
              <span className="text-sm font-medium text-foreground">
                {t.pawn.new_.notes}
              </span>
              <textarea
                name="notes"
                rows={2}
                className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
              />
            </label>
          </div>
        </fieldset>

        <div className="flex items-center justify-end gap-3">
          <Link
            href="/pawn"
            className="rounded-md border border-border px-4 py-2 text-sm text-foreground"
          >
            {t.common.cancel}
          </Link>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-gold px-4 py-2 text-navy font-medium hover:bg-gold-2 disabled:opacity-50"
          >
            {pending ? t.pawn.new_.submitting : t.pawn.new_.submit}
          </button>
        </div>
      </form>
    </div>
  )
}
