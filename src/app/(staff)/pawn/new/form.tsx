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
import VoicePawnButton, {
  type PawnVoiceData,
} from '@/components/pawn/VoicePawnButton'
import CustomerPicker, {
  type CustomerPickerHandle,
} from '@/components/customers/CustomerPicker'
import type { PawnIntakeCategory } from '@/components/pawn/CategoryPicker'
import {
  createLoanAction,
  type CreateLoanState,
} from './actions'

const PAWN_NEW_FORM_ID = 'pawn-new-form'

export type LoanRateOption = {
  id: string
  rateMonthly: number
  /** Per-rate floor on monthly interest. Null = no floor. */
  minMonthlyCharge: number | null
  label: string
  description: string | null
  isDefault: boolean
}

export default function NewPawnLoanForm({
  rates,
  minLoanAmount,
  categories,
}: {
  rates: LoanRateOption[]
  /** Tenant-wide min loan principal. Null = no minimum. */
  minLoanAmount: number | null
  /** Pre-filtered list — firearms-requiring categories are already
   *  excluded server-side when tenants.has_firearms is false. */
  categories: PawnIntakeCategory[]
}) {
  const { t } = useI18n()
  const [state, formAction, pending] = useActionState<
    CreateLoanState,
    FormData
  >(createLoanAction, {})

  const today = todayDateString()
  const [issueDate, setIssueDate] = useState<string>(today)
  const [termDays, setTermDays] = useState<string>('30')
  // Wizard step 1 — customer. Until a customer is picked, the rest
  // of the form stays hidden. Voice intake fills this via the
  // imperative handle which fires onChange.
  //
  // The pawn intake CATEGORY is picked PER COLLATERAL ITEM inside
  // CollateralItemsList — not at the loan level — because the
  // operator can pawn (e.g.) Jewelry→Ring + Electronics→Phone in
  // the same ticket.
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    null,
  )
  // Customer picker exposes an imperative handle so /api/ai/voice/
  // pawn-intake (match-or-create branch) can prefill the resolved
  // customer programmatically. The form input name="customer_id" is
  // emitted by the picker's hidden input.
  const customerPickerRef = useRef<CustomerPickerHandle>(null)
  // Principal is controlled so voice intake can pre-fill it. The
  // server action reads `principal` off FormData on submit, so the
  // controlled <input> still serializes correctly.
  const [principal, setPrincipal] = useState<string>('')

  // Default rate selection: configured default rate OR first active
  // rate OR empty string when the tenant has not configured any rates
  // yet (form blocks submit in that case — no fallback to a custom
  // rate). Operator must add a rate at /settings/loan-rates first.
  const defaultRateId =
    rates.find((r) => r.isDefault)?.id ?? rates[0]?.id ?? ''
  const [rateChoice, setRateChoice] = useState<string>(defaultRateId)

  const selectedRate = rates.find((r) => r.id === rateChoice) ?? null
  const submittedRate = selectedRate?.rateMonthly?.toString() ?? ''
  // Snapshot the rate's per-month minimum so the server writes it onto
  // loans.min_monthly_charge. Empty when the rate has no floor.
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
  // covers the high-frequency intake fields. The voiced collateral
  // row defaults to the 'general' pawn category (CollateralItemsList
  // supplies that fallback); operator can swap on the row.
  function handleVoiceData(data: PawnVoiceData) {
    if (data.customer) {
      customerPickerRef.current?.set({
        id: data.customer.id,
        label: data.customer.label,
      })
    }
    if (data.principal != null) {
      setPrincipal(data.principal.toString())
    }
    if (data.collateral) {
      collateralRef.current?.addExtractedRow(data.collateral)
    }
  }

  const revealReady = selectedCustomerId != null

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold">{t.pawn.new_.title}</h1>
        <Link href="/pawn" className="text-sm text-muted hover:text-foreground">
          {t.pawn.backToList}
        </Link>
      </div>

      <VoicePawnButton onDataExtracted={handleVoiceData} />

      <form
        id={PAWN_NEW_FORM_ID}
        action={formAction}
        // Block implicit Enter-key submission while the wizard is still
        // gated. The submit button only renders at the reveal step, but
        // browsers still implicit-submit a form whose only visible
        // input is single-line text (the customer search field).
        onSubmit={(e) => {
          if (!revealReady) e.preventDefault()
        }}
        className="space-y-6"
      >
        {/* Step 1 — Customer (always visible). Picking a customer
            unlocks the category step. */}
        <fieldset className="rounded-xl border border-border bg-card p-4">
          <legend className="px-1 text-sm font-semibold text-foreground">
            {t.pawn.new_.sectionCustomer}
          </legend>
          <p className="mt-1 text-xs text-muted">
            {t.pawn.new_.pickCustomerHelp}
          </p>
          <div className="mt-2 flex items-start gap-2">
            <div className="flex-1">
              <CustomerPicker
                ref={customerPickerRef}
                name="customer_id"
                required
                enableDlScan
                error={state.fieldErrors?.customer_id}
                onChange={(c) => setSelectedCustomerId(c?.id ?? null)}
              />
            </div>
            <Link
              href="/customers/new?return=/pawn/new"
              className="shrink-0 rounded-md border border-border bg-card px-3 py-3 text-sm text-foreground hover:bg-background hover:text-foreground"
            >
              {t.pawn.new_.newCustomer}
            </Link>
          </div>
        </fieldset>

        {/* Reveal — wizard step 1 (customer) done. Each collateral
            row carries its OWN pawn intake category picker, so the
            "category step" lives inside CollateralItemsList — not at
            the loan level. */}
        {revealReady ? (
          <>
            {state.error ? (
              <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
                {state.error}
              </div>
            ) : state.fieldErrors && Object.keys(state.fieldErrors).length > 0 ? (
              <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
                {t.common.fixErrorsBelow}
              </div>
            ) : null}

            {/* Terms — placed before collateral so the operator
                locks principal / rate / term first, then itemizes. */}
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
                  {/* Hidden field carries the actual rate value
                      submitted to the server. The visible <select>
                      chooses preset OR custom; the custom path swaps
                      in a number input. */}
                  <input
                    type="hidden"
                    name="interest_rate_monthly"
                    value={submittedRate}
                  />
                  {/* Snapshot of the selected rate's per-month
                      minimum (empty when the operator picked Custom
                      or the rate has no floor). The server reads
                      this onto loans.min_monthly_charge. */}
                  <input
                    type="hidden"
                    name="min_monthly_charge"
                    value={submittedMinCharge}
                  />
                  {rates.length > 0 ? (
                    <select
                      value={rateChoice}
                      onChange={(e) => setRateChoice(e.target.value)}
                      required
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
                          {r.isDefault
                            ? ` (${t.pawn.new_.rateDefaultBadge})`
                            : ''}
                        </option>
                      ))}
                    </select>
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

            {/* Collateral — itemized after the terms are locked. Each
                row begins with its own CategoryPicker, then exposes
                the rest of the item fields once a category is
                chosen. */}
            <fieldset className="rounded-xl border border-border bg-card p-4">
              <legend className="px-1 text-sm font-semibold text-foreground">
                {t.pawn.new_.sectionCollateral}
              </legend>
              <p className="mt-1 text-xs text-muted">
                {t.pawn.new_.itemMinOne}
              </p>
              <div className="mt-2">
                <CollateralItemsList
                  ref={collateralRef}
                  categories={categories}
                />
              </div>
            </fieldset>

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
          </>
        ) : null}
      </form>
    </div>
  )
}
