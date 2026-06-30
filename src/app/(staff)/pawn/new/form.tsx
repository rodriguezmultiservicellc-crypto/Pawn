'use client'

import { useActionState, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { CheckCircle, Upload, User } from '@phosphor-icons/react'
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
import QuickCustomerModal from '@/components/customers/QuickCustomerModal'
import type { PawnIntakeCategory } from '@/components/pawn/CategoryPicker'
import { createLoanAction, type CreateLoanState } from './actions'

const PAWN_NEW_FORM_ID = 'pawn-new-form'

export type LoanRateOption = {
  id: string
  rateMonthly: number
  minMonthlyCharge: number | null
  label: string
  description: string | null
  isDefault: boolean
}

function fmtMoney(v: number): string {
  if (!isFinite(v)) return '—'
  return v.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  })
}

export default function NewPawnLoanForm({
  rates,
  minLoanAmount,
  categories,
}: {
  rates: LoanRateOption[]
  minLoanAmount: number | null
  categories: PawnIntakeCategory[]
}) {
  const { t } = useI18n()
  const tn = t.pawn.new_
  const [state, formAction, pending] = useActionState<CreateLoanState, FormData>(
    createLoanAction,
    {},
  )

  // Issue date locked to today (no back-dating from intake). Server also
  // defaults to today when missing.
  const today = todayDateString()
  const issueDate = today
  const [termDays, setTermDays] = useState<string>('30')
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    null,
  )
  const [customerLabel, setCustomerLabel] = useState<string | null>(null)
  const customerPickerRef = useRef<CustomerPickerHandle>(null)
  const [showCustomerModal, setShowCustomerModal] = useState(false)
  const [principal, setPrincipal] = useState<string>('')

  // Live collateral totals reported up from the editor → drives the rail's
  // collateral-value box + LTV state.
  const [collateralCount, setCollateralCount] = useState(0)
  const [collateralValue, setCollateralValue] = useState(0)

  const defaultRateId = rates.find((r) => r.isDefault)?.id ?? rates[0]?.id ?? ''
  const [rateChoice, setRateChoice] = useState<string>(defaultRateId)
  const selectedRate = rates.find((r) => r.id === rateChoice) ?? null
  const submittedRate = selectedRate?.rateMonthly?.toString() ?? ''
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
  const collateralRef = useRef<CollateralListHandle>(null)

  function onSigChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSigPreview(e.target.files?.[0]?.name ?? null)
  }

  function handleVoiceData(data: PawnVoiceData) {
    if (data.customer) {
      customerPickerRef.current?.set({
        id: data.customer.id,
        label: data.customer.label,
      })
    }
    if (data.principal != null) setPrincipal(data.principal.toString())
    if (data.collateral) collateralRef.current?.addExtractedRow(data.collateral)
  }

  // ── Live money math (display only; server recomputes on submit) ──────
  const principalNum = parseFloat(principal) || 0
  const rateMonthly = selectedRate?.rateMonthly ?? 0
  const months = (parseInt(termDays || '0', 10) || 0) / 30
  const interest = principalNum * rateMonthly * months
  const redemption = principalNum + interest

  const ltvState: 'neutral' | 'ok' | 'over' =
    principalNum <= 0 || collateralValue <= 0
      ? 'neutral'
      : principalNum > collateralValue
      ? 'over'
      : 'ok'
  const ltvPct =
    collateralValue > 0 ? Math.round((principalNum / collateralValue) * 100) : 0

  const revealReady = selectedCustomerId != null
  const canIssue =
    !pending && revealReady && principalNum > 0 && collateralCount > 0

  return (
    <form
      id={PAWN_NEW_FORM_ID}
      action={formAction}
      onSubmit={(e) => {
        if (!canIssue) e.preventDefault()
      }}
    >
      {/* Sub bar */}
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold">{tn.title}</h1>
        <Link href="/pawn" className="text-sm text-muted hover:text-foreground">
          {t.pawn.backToList}
        </Link>
      </div>

      <div className="grid grid-cols-1 items-start gap-[18px] lg:grid-cols-[1fr_360px]">
        {/* ── LEFT: work surface ─────────────────────────────────────── */}
        <div className="space-y-4">
          <VoicePawnButton onDataExtracted={handleVoiceData} />

          {state.error ? (
            <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
              {state.error}
            </div>
          ) : state.fieldErrors &&
            Object.keys(state.fieldErrors).length > 0 ? (
            <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
              {t.common.fixErrorsBelow}
            </div>
          ) : null}

          {/* Customer */}
          <fieldset className="rounded-xl border border-border bg-card p-4">
            <legend className="px-1 text-sm font-semibold text-foreground">
              {tn.sectionCustomer}
            </legend>
            <p className="mt-1 text-xs font-medium text-warning">
              {tn.pickCustomerHelp}
            </p>
            <div className="mt-2 flex items-start gap-2">
              <div className="flex-1">
                <CustomerPicker
                  ref={customerPickerRef}
                  name="customer_id"
                  required
                  enableDlScan
                  error={state.fieldErrors?.customer_id}
                  onChange={(c) => {
                    setSelectedCustomerId(c?.id ?? null)
                    setCustomerLabel(c?.label ?? null)
                  }}
                />
              </div>
              <button
                type="button"
                onClick={() => setShowCustomerModal(true)}
                className="shrink-0 rounded-md border border-border bg-card px-3 py-3 text-sm text-foreground hover:bg-background hover:text-foreground"
              >
                {tn.newCustomer}
              </button>
            </div>
          </fieldset>

          <QuickCustomerModal
            open={showCustomerModal}
            onClose={() => setShowCustomerModal(false)}
            onCreated={(c) => {
              customerPickerRef.current?.set(c)
              setSelectedCustomerId(c.id)
              setCustomerLabel(c.label)
            }}
          />

          {/* Collateral */}
          <fieldset className="rounded-xl border border-border bg-card p-4">
            <legend className="px-1 text-sm font-semibold text-foreground">
              {tn.sectionCollateral}
            </legend>
            <p className="mt-1 text-xs text-muted">{tn.itemMinOne}</p>
            <div className="mt-2">
              <CollateralItemsList
                ref={collateralRef}
                categories={categories}
                onTotalsChange={(count, total) => {
                  setCollateralCount(count)
                  setCollateralValue(total)
                }}
              />
            </div>
          </fieldset>

          {/* Signature & notes */}
          <fieldset className="rounded-xl border border-border bg-card p-4">
            <legend className="px-1 text-sm font-semibold text-foreground">
              {tn.sectionSignature}
            </legend>
            <div className="mt-2 space-y-3">
              <div>
                <span className="block text-sm font-medium text-foreground">
                  {tn.signature}
                </span>
                <p className="mb-1 text-xs text-muted">{tn.signatureHelp}</p>
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
                  {tn.notes}
                </span>
                <textarea
                  name="notes"
                  rows={2}
                  className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
                />
              </label>
            </div>
          </fieldset>
        </div>

        {/* ── RIGHT: loan summary rail ──────────────────────────────── */}
        <aside className="rounded-2xl bg-navy p-[18px] text-white shadow-lg lg:sticky lg:top-4">
          {/* Financing type */}
          <div className="mb-4 grid grid-cols-2 gap-1.5 rounded-xl bg-white/[0.06] p-1">
            <span className="rounded-lg bg-gold px-3 py-2.5 text-center text-[13px] font-bold text-navy">
              {tn.financingPawn}
            </span>
            <Link
              href="/buy/new"
              className="rounded-lg px-3 py-2.5 text-center text-[13px] font-bold text-white/60 hover:text-white"
            >
              {tn.financingBuy}
            </Link>
          </div>

          <h2 className="mb-3.5 text-[11px] font-bold uppercase tracking-[0.08em] text-white/50">
            {tn.railSummaryTitle}
          </h2>

          {/* Customer chip */}
          <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gold/15 text-gold">
              <User size={16} weight="bold" />
            </span>
            <span className="min-w-0 truncate text-[13.5px] font-bold">
              {customerLabel ?? tn.railNoCustomer}
            </span>
          </div>

          {/* Principal + collateral value */}
          <div className="mb-3.5 grid grid-cols-[1.1fr_0.9fr] items-end gap-2.5">
            <label className="block">
              <span className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-[0.05em] text-white/55">
                {tn.principal}
              </span>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-bold text-white/50">
                  $
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
                  className="h-14 w-full rounded-lg border border-white/15 bg-white/[0.07] pl-7 pr-3 text-[23px] font-extrabold tabular-nums text-white outline-none focus:border-gold"
                />
              </div>
            </label>
            <div
              className={`rounded-lg border-[1.5px] px-3 py-2.5 ${
                ltvState === 'ok'
                  ? 'border-success/55 bg-success/10'
                  : ltvState === 'over'
                  ? 'border-gold/60 bg-gold/15'
                  : 'border-white/15 bg-white/[0.06]'
              }`}
            >
              <div className="text-[9.5px] font-bold uppercase tracking-[0.05em] text-white/55">
                {tn.collateralValue}
              </div>
              <div className="mt-0.5 text-[21px] font-extrabold tabular-nums">
                {fmtMoney(collateralValue)}
              </div>
              <div
                className={`mt-0.5 text-[10.5px] font-bold ${
                  ltvState === 'ok'
                    ? 'text-success'
                    : ltvState === 'over'
                    ? 'text-gold-2'
                    : 'text-white/50'
                }`}
              >
                {ltvState === 'ok'
                  ? `✓ ${tn.ltvCovered.replace('{pct}', String(ltvPct))}`
                  : ltvState === 'over'
                  ? `⚠ ${tn.ltvOver}`
                  : `${collateralCount} ${
                      collateralCount === 1 ? tn.itemOne : tn.itemMany
                    }`}
              </div>
            </div>
          </div>

          {/* Hidden rate fields submitted to the server */}
          <input type="hidden" name="interest_rate_monthly" value={submittedRate} />
          <input type="hidden" name="min_monthly_charge" value={submittedMinCharge} />

          {/* Rate */}
          <label className="mb-3 block">
            <span className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-[0.05em] text-white/55">
              {tn.interestRate}
            </span>
            {rates.length > 0 ? (
              <select
                value={rateChoice}
                onChange={(e) => setRateChoice(e.target.value)}
                required
                className="h-[42px] w-full rounded-lg border border-white/15 bg-white/[0.07] px-3 text-sm font-bold text-white outline-none focus:border-gold [&>option]:text-navy"
              >
                {rates.map((r) => (
                  <option key={r.id} value={r.id}>
                    {(r.rateMonthly * 100).toFixed(2)}% — {r.label}
                    {r.isDefault ? ` (${tn.rateDefaultBadge})` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-xs text-white/55">{tn.rateNoneConfigured}</p>
            )}
            <span className="mt-1 block text-[11px] text-white/45">
              {selectedRateDescription ?? tn.manageRatesHint}
            </span>
          </label>

          {/* Term + issue date */}
          <div className="grid grid-cols-2 gap-2.5">
            <label className="block">
              <span className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-[0.05em] text-white/55">
                {tn.termDays}
              </span>
              <input
                type="number"
                min={1}
                max={180}
                name="term_days"
                required
                value={termDays}
                onChange={(e) => setTermDays(e.target.value)}
                className="h-[42px] w-full rounded-lg border border-white/15 bg-white/[0.07] px-3 text-sm font-bold tabular-nums text-white outline-none focus:border-gold"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-[0.05em] text-white/55">
                {tn.issueDate}
              </span>
              <input
                type="date"
                name="issue_date"
                value={issueDate}
                readOnly
                className="h-[42px] w-full rounded-lg border border-white/15 bg-white/[0.04] px-3 text-sm font-semibold text-white/70 outline-none"
              />
            </label>
          </div>
          <input type="hidden" name="due_date" value={computedDueDate} />

          <div className="mt-2 flex items-center justify-between px-0.5 py-2 text-[13px]">
            <span className="font-semibold text-white/60">
              {tn.dueDate} <span className="text-white/40">{tn.dueDateAuto}</span>
            </span>
            <span className="font-bold tabular-nums">{computedDueDate || '—'}</span>
          </div>
          <div className="flex items-center justify-between px-0.5 pb-1 text-[13px]">
            <span className="font-semibold text-white/60">
              {tn.collateralItemsLabel}
            </span>
            <span className="font-bold tabular-nums">{collateralCount}</span>
          </div>

          {/* Redemption */}
          <div className="my-2.5 rounded-xl border border-gold/25 bg-gold/10 p-3.5">
            <div className="text-[11px] font-bold uppercase tracking-[0.05em] text-white/60">
              {tn.redemptionLabel}
            </div>
            <div className="mt-1 text-[30px] font-extrabold tabular-nums">
              {fmtMoney(redemption)}
            </div>
            <div className="mt-1 text-[11.5px] font-semibold text-gold-2">
              {tn.redemptionIncludes.replace('{amount}', fmtMoney(interest))}
            </div>
          </div>

          {state.fieldErrors?.principal ? (
            <p className="mb-1 text-[11.5px] font-semibold text-gold-2">
              {tn.principalMinHint.replace(
                '{amount}',
                minLoanAmount != null ? `$${minLoanAmount.toFixed(2)}` : '',
              )}
            </p>
          ) : null}

          {/* Issue */}
          <button
            type="submit"
            disabled={!canIssue}
            className="mt-1 flex h-14 w-full items-center justify-center gap-2.5 rounded-xl bg-gradient-to-b from-gold-2 to-gold text-base font-extrabold text-[#3a2600] shadow-lg transition-all hover:-translate-y-0.5 hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none disabled:hover:translate-y-0"
          >
            <CheckCircle size={18} weight="bold" />
            {pending ? tn.submitting : tn.submit}
          </button>
          {!canIssue && !pending ? (
            <p className="mt-2.5 text-center text-[11.5px] font-semibold text-white/50">
              {tn.railMissingHint}
            </p>
          ) : null}
        </aside>
      </div>
    </form>
  )
}
