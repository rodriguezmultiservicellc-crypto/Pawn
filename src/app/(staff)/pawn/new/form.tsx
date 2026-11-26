'use client'

import {
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react'
import Link from 'next/link'
import { CheckCircle, FloppyDisk, Plus, Upload } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { fitInputFiles } from '@/lib/uploads/fit-photo'
import StalePriceBanner, {
  StaleSpotConfirm,
} from '@/components/inventory/StalePriceBanner'
import type { SpotFreshness } from '@/lib/spot-prices/staleness'
import type { RateMaps } from '@/lib/metal-counter/math'
import { addDaysIso } from '@/lib/pawn/math'
import {
  moneyTextToCents,
  principalAfterCollateralChange,
  principalFieldText,
} from '@/lib/pawn/principal-follow'
import {
  exceedsCap,
  maxMonthlyRate,
  type RateTier,
} from '@/lib/jurisdictions/rules'
import { ruleErrorText } from '@/lib/jurisdictions/messages'
import { saveLoanDraft } from '../drafts/actions'
import { DraftHandoffButton, TicketMovedNotice } from '@/components/pawn/DraftHandoff'
import {
  type LoanDraftPayload,
} from '@/lib/pawn/intake-form'
import {
  CollateralItemsList,
  type CollateralListHandle,
} from '@/components/pawn/CollateralItemsList'
import type { InventoryCategory, MetalType } from '@/types/database-aliases'
import { CustomerPawnHistory } from '@/components/pawn/CustomerPawnHistory'
import type { CustomerPawnHistory as PawnHistory } from '@/lib/pawn/customer-history'
import { loadCustomerPawnHistoryAction } from './history-actions'
import VoicePawnButton, {
  type PawnVoiceData,
} from '@/components/pawn/VoicePawnButton'
import { PledgorRecordBanner } from '@/components/customers/PledgorRecordBanner'
import CustomerPicker, {
  type CustomerPickerHandle,
} from '@/components/customers/CustomerPicker'
import QuickCustomerModal from '@/components/customers/QuickCustomerModal'
import type { PawnIntakeCategory } from '@/components/pawn/CategoryPicker'
import {
  FOCUS,
  INPUT,
  INPUT_READONLY,
  LABEL,
  OUTLINE_BTN,
  PRIMARY_BTN,
} from '@/lib/ui/ledger'
import { createLoanAction, type CreateLoanState } from './actions'
import { createPurchaseAction, type CreatePurchaseState } from './purchase-actions'
import BuyPayoutSelect, { type BuyPayoutMethod } from '@/components/buy/BuyPayoutSelect'
import MixedTenderFields, { mixedSplitOk } from '@/components/buy/MixedTenderFields'
import type { StripPhoto } from '@/components/uploads/PhotoStrip'

const PAWN_NEW_FORM_ID = 'pawn-new-form'

export type LoanRateOption = {
  id: string
  rateMonthly: number
  minMonthlyCharge: number | null
  label: string
  description: string | null
  isDefault: boolean
}

export type DraftInitial = {
  id: string
  customerId: string
  payload: LoanDraftPayload
  /** Each draft item's photos, signed to show (same order as the items). */
  photos: StripPhoto[][]
}

/** Statutory limits from the tenant's jurisdiction (patches/0048). */
export type IntakeLoanRules = {
  jurisdictionName: string | null
  minTermDays: number | null
  maxTermDays: number | null
  rateCapMonthly: number | null
  rateTiers: RateTier[] | null
  /** Shop-local today (tenant timezone). */
  today: string
}

function fmtMoney(v: number): string {
  if (!isFinite(v)) return '—'
  return v.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  })
}

/**
 * New pawn ticket — "Ledger" layout (same locked tokens as POS New sale):
 * customer row, category pills + collateral table, signature beside notes,
 * then one full-width loan summary bar (terms · summary · total + actions).
 * Layout only: every field name, calculation and gate is unchanged.
 */
export default function NewPawnLoanForm({
  rates,
  minLoanAmount,
  loanRules,
  categories,
  initialDraft,
  spotFreshness,
  metalRates,
  canConfirmStale,
  tenantId,
  purchase: purchaseSetup,
  handoff,
}: {
  /** Opened from another device's QR code (?handoff=): what came of it. */
  handoff: 'claimed' | 'expired' | 'used' | null
  /** The shop: item photos upload into its folder. */
  tenantId: string
  /** Its state writes purchases on the transaction form (patches/0115):
   *  "Buy outright" turns this screen into a purchase. Null = it does not,
   *  and Buy outright is its own screen. */
  purchase: {
    startInPurchase: boolean
    buyHoldDays: number
    storeCreditEnabled: boolean
  } | null
  rates: LoanRateOption[]
  minLoanAmount: number | null
  loanRules: IntakeLoanRules
  categories: PawnIntakeCategory[]
  initialDraft: DraftInitial | null
  /** 24h stale-price rule — drives the red banner + manager confirm. */
  spotFreshness: SpotFreshness
  /** Spot per gram + the shop's pay percent, for an item's metal value. */
  metalRates: RateMaps
  /** owner / manager / chain_admin may confirm issuing at a stale price. */
  canConfirmStale: boolean
}) {
  const { t } = useI18n()
  const tn = t.pawn.new_
  const [loanState, loanAction, loanPending] = useActionState<CreateLoanState, FormData>(
    createLoanAction,
    {},
  )
  const [purchaseState, purchaseAction, purchasePending] = useActionState<
    CreatePurchaseState,
    FormData
  >(createPurchaseAction, {})
  // Pawn ticket or purchase: the same screen, the same customer and items.
  const [mode, setMode] = useState<'pawn' | 'purchase'>(
    purchaseSetup?.startInPurchase ? 'purchase' : 'pawn',
  )
  const isPurchase = mode === 'purchase' && purchaseSetup != null
  const state = isPurchase ? purchaseState : loanState
  const pending = isPurchase ? purchasePending : loanPending
  // How the seller is paid (a purchase).
  const [payoutMethod, setPayoutMethod] = useState<BuyPayoutMethod>('cash')
  const [paidCash, setPaidCash] = useState('')
  const [paidTransfer, setPaidTransfer] = useState('')
  // Stale guard, client half. The form doesn't know per-row metal, so it
  // shows the confirm whenever prices are stale and lets the server decide
  // (lib/spot-prices/stale-gate only holds loans that price metal).
  const [staleAck, setStaleAck] = useState(false)
  const [savingDraft, startSaveDraft] = useTransition()
  // The draft this ticket is saved as (resumed, or saved by the QR handoff).
  const [savedDraftId, setSavedDraftId] = useState<string | null>(initialDraft?.id ?? null)
  // The ticket moved to another device through the QR code: this screen
  // closes its copy, so the same ticket is never issued twice.
  const [moved, setMoved] = useState(false)
  const onMoved = useCallback(() => setMoved(true), [])
  // Arrived through a QR code: drop the one-time code from the address bar,
  // so a reload does not say "already used".
  useEffect(() => {
    if (!handoff || !initialDraft) return
    window.history.replaceState(null, '', `/pawn/new?draft=${initialDraft.id}`)
  }, [handoff, initialDraft])

  // Issue date locked to today (no back-dating from intake). Server also
  // defaults to today when missing.
  const today = loanRules.today
  const issueDate = today
  // Fixed-term jurisdictions (FL: maturity is exactly 30 days) lock the
  // input; otherwise default to the statutory minimum or 30.
  const termFixed =
    loanRules.minTermDays != null &&
    loanRules.minTermDays === loanRules.maxTermDays
  const defaultTerm = String(loanRules.minTermDays ?? 30)
  const [termDays, setTermDays] = useState<string>(
    termFixed ? defaultTerm : initialDraft?.payload.term_days || defaultTerm,
  )
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    initialDraft?.customerId ?? null,
  )
  const customerPickerRef = useRef<CustomerPickerHandle>(null)
  const [showCustomerModal, setShowCustomerModal] = useState(false)
  const [principal, setPrincipal] = useState<string>(
    initialDraft?.payload.principal ?? '',
  )
  // The principal follows the collateral (lib/pawn/principal-follow): the
  // same amount in whole cents, moved by every change in the collateral
  // total. Kept beside the field's text so a half-typed amount stays as
  // typed, and so an amount the clerk typed carries on to the next item.
  const principalCentsRef = useRef(
    moneyTextToCents(initialDraft?.payload.principal ?? ''),
  )
  const collateralCentsRef = useRef(0)
  // Set when rows are about to arrive with a principal that already counts
  // them (a resumed draft, an amount spoken to voice intake): the next
  // change in the collateral total is noted, not added.
  const principalSettledRef = useRef(false)

  function typePrincipal(text: string) {
    setPrincipal(text)
    principalCentsRef.current = moneyTextToCents(text)
  }

  // Live collateral totals reported up from the editor → drives the
  // summary bar's collateral value + LTV state, and the principal.
  const [collateralCount, setCollateralCount] = useState(0)
  const [collateralValue, setCollateralValue] = useState(0)
  const onCollateralTotals = useCallback((count: number, total: number) => {
    setCollateralCount(count)
    setCollateralValue(total)
    const cents = Math.round(total * 100)
    const delta = cents - collateralCentsRef.current
    collateralCentsRef.current = cents
    if (delta !== 0 && principalSettledRef.current) {
      principalSettledRef.current = false
      return
    }
    const next = principalAfterCollateralChange(
      principalCentsRef.current,
      delta,
      count,
    )
    if (next === principalCentsRef.current) return
    principalCentsRef.current = next
    setPrincipal(principalFieldText(next))
  }, [])

  const defaultRateId = rates.find((r) => r.isDefault)?.id ?? rates[0]?.id ?? ''
  const draftRateId = initialDraft?.payload.rate_id
  const seededRateId =
    draftRateId && rates.some((r) => r.id === draftRateId)
      ? draftRateId
      : defaultRateId
  const [rateChoice, setRateChoice] = useState<string>(seededRateId)
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

  // The picked customer's pawn history. Kept with the customer it belongs
  // to, so a slow answer for the previous customer is never shown for the
  // next one.
  const [historyState, setHistoryState] = useState<{
    customerId: string
    history: PawnHistory | null
    failed: boolean
  } | null>(null)
  useEffect(() => {
    if (!selectedCustomerId) return
    let live = true
    const customerId = selectedCustomerId
    loadCustomerPawnHistoryAction(customerId)
      .then((res) => {
        if (live) setHistoryState({ customerId, history: res.ok ? res.history : null, failed: !res.ok })
      })
      .catch(() => {
        if (live) setHistoryState({ customerId, history: null, failed: true })
      })
    return () => {
      live = false
    }
  }, [selectedCustomerId])
  const customerHistory =
    historyState && historyState.customerId === selectedCustomerId ? historyState : null

  // Resume a saved draft: inject its collateral rows into the editor once on
  // mount, with their photos (already in storage, signed by the page). Category slugs
  // aren't restored by addExtractedRow yet (same limitation as voice intake)
  // — the operator re-confirms each row's category before issuing.
  const draftAppliedRef = useRef(false)
  useEffect(() => {
    if (draftAppliedRef.current || !initialDraft) return
    draftAppliedRef.current = true
    // The draft's principal was saved with these rows already counted in it.
    principalSettledRef.current =
      principalCentsRef.current > 0 &&
      initialDraft.payload.collateral.some(
        (row) => moneyTextToCents(row.est_value ?? '') > 0,
      )
    for (const [i, row] of initialDraft.payload.collateral.entries()) {
      collateralRef.current?.addExtractedRow({
        photos: initialDraft.photos[i] ?? [],
        description: row.description ?? '',
        category: (row.category || 'other') as InventoryCategory,
        metal_type: (row.metal_type || '') as MetalType | '',
        karat: row.karat ?? '',
        weight_grams: row.weight_grams ?? '',
        est_value: row.est_value ?? '',
      })
    }
  }, [initialDraft])

  // A photographed signature: HEIC becomes JPEG and a big photo shrinks
  // (lib/uploads/fit-photo); a PDF goes as it is.
  async function onSigChange(e: React.ChangeEvent<HTMLInputElement>) {
    const [file] = await fitInputFiles(e.currentTarget, t.common.preparingPhoto)
    setSigPreview(file?.name ?? null)
  }

  function onSaveDraft() {
    const formEl = document.getElementById(
      PAWN_NEW_FORM_ID,
    ) as HTMLFormElement | null
    if (!formEl) return
    const fd = new FormData(formEl)
    startSaveDraft(async () => {
      await saveLoanDraft(fd)
    })
  }

  function handleVoiceData(data: PawnVoiceData) {
    if (data.customer) {
      customerPickerRef.current?.set({
        id: data.customer.id,
        label: data.customer.label,
      })
    }
    if (data.principal != null) {
      typePrincipal(data.principal.toString())
      // The amount spoken is the loan: the item's value is not added on top.
      if (data.collateral && moneyTextToCents(data.collateral.est_value) > 0) {
        principalSettledRef.current = true
      }
    }
    if (data.collateral) collateralRef.current?.addExtractedRow(data.collateral)
  }

  // ── Live money math (display only; server recomputes on submit) ──────
  const principalNum = parseFloat(principal) || 0
  const rateMonthly = selectedRate?.rateMonthly ?? 0
  const months = (parseInt(termDays || '0', 10) || 0) / 30
  const interest = principalNum * rateMonthly * months
  const redemption = principalNum + interest

  // Tiered caps depend on principal — warn before the server rejects.
  const rateCap = maxMonthlyRate(
    { rate_cap_monthly: loanRules.rateCapMonthly, rate_tiers: loanRules.rateTiers },
    principalNum > 0 ? principalNum : null,
  )
  const overCap = selectedRate != null && exceedsCap(rateMonthly, rateCap)

  const ltvState: 'neutral' | 'ok' | 'over' =
    principalNum <= 0 || collateralValue <= 0
      ? 'neutral'
      : principalNum > collateralValue
      ? 'over'
      : 'ok'
  const ltvPct =
    collateralValue > 0 ? Math.round((principalNum / collateralValue) * 100) : 0

  const revealReady = selectedCustomerId != null
  const canIssue = isPurchase
    ? !pending &&
      revealReady &&
      collateralCount > 0 &&
      collateralValue > 0 &&
      (payoutMethod !== 'mixed' || mixedSplitOk(collateralValue, paidCash, paidTransfer))
    : !pending &&
      revealReady &&
      principalNum > 0 &&
      collateralCount > 0 &&
      !overCap
  const holdUntil =
    purchaseSetup && purchaseSetup.buyHoldDays > 0
      ? addDaysIso(today, purchaseSetup.buyHoldDays)
      : null

  const itemsText = `${collateralCount} ${collateralCount === 1 ? tn.itemOne : tn.itemMany}`
  const HINT = 'text-[13px] text-muted'

  if (moved) return <TicketMovedNotice />

  return (
    <form
      id={PAWN_NEW_FORM_ID}
      action={isPurchase ? purchaseAction : loanAction}
      onSubmit={(e) => {
        if (!canIssue) e.preventDefault()
      }}
      className="mx-auto w-full max-w-[1440px] space-y-6"
    >
      {/* No visible title row: the sidebar is the way back to Pawn loans.
          The heading stays for screen readers. */}
      <h1 className="sr-only">{isPurchase ? tn.titlePurchase : tn.title}</h1>

      {handoff ? (
        <div
          role="status"
          className={`rounded-md border px-3 py-2 text-sm ${
            handoff === 'claimed'
              ? 'border-success/30 bg-success/5 text-foreground'
              : 'border-warning/40 bg-warning/5 text-foreground'
          }`}
        >
          {handoff === 'claimed' ? tn.handoff.arrived : tn.handoff.invalid}
        </div>
      ) : null}

      {/* Top row: Pawn loan / Buy outright · Hold to talk */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div
          role="group"
          aria-label={tn.financingLabel}
          className="inline-flex overflow-hidden rounded-md border border-foreground"
        >
          {purchaseSetup ? (
            // FL: a buy is written here too, marked Purchase (patches/0115).
            (['pawn', 'purchase'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
                className={`inline-flex h-11 items-center px-5 text-sm font-semibold ${FOCUS} ${
                  mode === m
                    ? 'bg-foreground text-white'
                    : 'bg-card text-foreground hover:bg-background'
                }`}
              >
                {m === 'pawn' ? tn.financingPawn : tn.financingBuy}
              </button>
            ))
          ) : (
            <>
              <span
                aria-current="page"
                className="inline-flex h-11 items-center bg-foreground px-5 text-sm font-semibold text-white"
              >
                {tn.financingPawn}
              </span>
              <Link
                href="/buy/new"
                className={`inline-flex h-11 items-center bg-card px-5 text-sm font-semibold text-foreground hover:bg-background ${FOCUS}`}
              >
                {tn.financingBuy}
              </Link>
            </>
          )}
        </div>
        {selectedCustomerId ? (
          <CustomerPawnHistory
            customerId={selectedCustomerId}
            history={customerHistory?.history ?? null}
            failed={customerHistory?.failed ?? false}
          />
        ) : null}
        <VoicePawnButton onDataExtracted={handleVoiceData} />
      </div>

      <StalePriceBanner freshness={spotFreshness} />

      {state.error ? (
        <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {ruleErrorText(t, state.error)}
        </div>
      ) : state.fieldErrors &&
        Object.keys(state.fieldErrors).length > 0 ? (
        <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {t.common.fixErrorsBelow}
        </div>
      ) : null}

      {/* 1 · Customer */}
      <section className="space-y-2">
        <h2 className={LABEL}>1 · {tn.sectionCustomer}</h2>
        <CustomerPicker
          ref={customerPickerRef}
          name="customer_id"
          required
          enableDlScan
          size="lg"
          initialCustomerId={initialDraft?.customerId ?? null}
          error={state.fieldErrors?.customer_id}
          onChange={(c) => setSelectedCustomerId(c?.id ?? null)}
          trailing={
            <button
              type="button"
              onClick={() => setShowCustomerModal(true)}
              className={`${OUTLINE_BTN} h-[52px]`}
            >
              <Plus size={14} weight="bold" />
              {tn.newCustomerShort}
            </button>
          }
        />
        <p className={HINT}>{tn.pickCustomerHelp}</p>
        <PledgorRecordBanner customerId={selectedCustomerId} />
      </section>

      <QuickCustomerModal
        open={showCustomerModal}
        onClose={() => setShowCustomerModal(false)}
        onCreated={(c) => {
          customerPickerRef.current?.set(c)
          setSelectedCustomerId(c.id)
        }}
      />

      {/* 2 · Add collateral — pills + collateral table */}
      <section>
        <CollateralItemsList
          ref={collateralRef}
          categories={categories}
          metalRates={metalRates}
          title={`2 · ${isPurchase ? tn.sectionPurchaseItems : tn.sectionAddCollateral}`}
          valueLabel={isPurchase ? tn.purchaseAmount : undefined}
          previousItems={customerHistory?.history?.previous_items ?? []}
          onTotalsChange={onCollateralTotals}
          tenantId={tenantId}
        />
      </section>

      {/* 3 · Customer signature · Notes */}
      <section className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {isPurchase ? (
          <p className={`${HINT} self-end`}>{tn.purchaseFormNote}</p>
        ) : (
        <div className="space-y-2">
          <h2 className={LABEL}>3 · {tn.signature}</h2>
          <button
            type="button"
            onClick={() => sigInputRef.current?.click()}
            className={OUTLINE_BTN}
          >
            <Upload size={16} weight="bold" />
            {sigPreview ?? tn.signatureUpload}
          </button>
          <p className={HINT}>{tn.signatureHelp}</p>
          <input
            ref={sigInputRef}
            type="file"
            name="signature_file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.pdf"
            onChange={onSigChange}
            className="sr-only"
          />
        </div>
        )}
        <label className="block space-y-2">
          <span className={`block ${LABEL}`}>{tn.notes}</span>
          <textarea
            name="notes"
            rows={3}
            defaultValue={initialDraft?.payload.notes ?? ''}
            className={`block w-full rounded-md border border-border bg-card px-3 py-2.5 text-sm text-foreground outline-none focus:border-blue ${FOCUS}`}
          />
        </label>
      </section>

      {isPurchase ? (
        <section
          aria-label={tn.purchaseTotal}
          className="grid grid-cols-1 divide-y divide-border rounded-lg border border-foreground bg-card lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)] lg:divide-x lg:divide-y-0"
        >
          {/* a. How the seller is paid */}
          <div className="space-y-3 p-5">
            <BuyPayoutSelect
              value={payoutMethod}
              onChange={setPayoutMethod}
              storeCreditEnabled={purchaseSetup?.storeCreditEnabled ?? false}
              labelClassName={LABEL}
              selectClassName={INPUT}
            />
            {payoutMethod === 'mixed' ? (
              <MixedTenderFields
                total={collateralValue}
                cash={paidCash}
                transfer={paidTransfer}
                onCashChange={setPaidCash}
                onTransferChange={setPaidTransfer}
              />
            ) : null}
          </div>

          {/* b. Items · the hold */}
          <dl className="space-y-4 p-5 text-sm">
            <div>
              <dt className={LABEL}>{tn.sectionPurchaseItems}</dt>
              <dd className="mt-1 text-foreground">{itemsText}</dd>
            </div>
            {holdUntil && purchaseSetup ? (
              <dd className={HINT}>
                {tn.purchaseHold
                  .replace('{days}', String(purchaseSetup.buyHoldDays))
                  .replace('{date}', holdUntil)}
              </dd>
            ) : null}
          </dl>

          {/* c. Total + submit */}
          <div className="space-y-3 p-5">
            <div>
              <div className={LABEL}>{tn.purchaseTotal}</div>
              <div className="mt-1 font-mono text-[40px] font-bold leading-tight tabular-nums text-foreground">
                {fmtMoney(collateralValue)}
              </div>
            </div>
            <StaleSpotConfirm
              freshness={spotFreshness}
              canConfirm={canConfirmStale}
              checked={staleAck}
              onChange={setStaleAck}
            />
            <button
              type="submit"
              disabled={!canIssue}
              className={`${PRIMARY_BTN} h-14 w-full text-base`}
            >
              <CheckCircle size={18} weight="bold" />
              {pending ? tn.purchaseSubmitting : tn.purchaseSubmit}
            </button>
            {!canIssue && !pending ? (
              <p className={`${HINT} text-center`}>{tn.purchaseMissingHint}</p>
            ) : null}
          </div>
        </section>
      ) : (
      <>
      {/* Hidden fields submitted to the server */}
      <input type="hidden" name="interest_rate_monthly" value={submittedRate} />
      <input type="hidden" name="min_monthly_charge" value={submittedMinCharge} />
      {/* rate_id is staged in drafts so the rate select can be restored. */}
      <input type="hidden" name="rate_id" value={rateChoice} />
      {savedDraftId ? (
        <input type="hidden" name="draft_id" value={savedDraftId} />
      ) : null}
      <input type="hidden" name="due_date" value={computedDueDate} />

      {/* Loan summary bar: terms · summary · total + actions */}
      <section
        aria-label={tn.railSummaryTitle}
        className="grid grid-cols-1 divide-y divide-border rounded-lg border border-foreground bg-card lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)] lg:divide-x lg:divide-y-0"
      >
        {/* a. Terms */}
        <div className="space-y-3 p-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className={`block ${LABEL}`}>{tn.principal}</span>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-lg font-semibold text-muted">
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
                  onChange={(e) => typePrincipal(e.target.value)}
                  className={`block h-11 w-full rounded-md border-2 border-blue bg-card pl-7 pr-3 font-mono text-lg font-semibold tabular-nums text-foreground outline-none ${FOCUS}`}
                />
              </div>
            </label>

            <label className="block space-y-1.5">
              <span className={`block ${LABEL}`}>{tn.interestRate}</span>
              {rates.length > 0 ? (
                <select
                  value={rateChoice}
                  onChange={(e) => setRateChoice(e.target.value)}
                  required
                  className={INPUT}
                >
                  {rates.map((r) => (
                    <option key={r.id} value={r.id}>
                      {(r.rateMonthly * 100).toFixed(2)}% — {r.label}
                      {r.isDefault ? ` (${tn.rateDefaultBadge})` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <p className={HINT}>{tn.rateNoneConfigured}</p>
              )}
            </label>

            <label className="block space-y-1.5">
              <span className={`block ${LABEL}`}>{tn.termDays}</span>
              <input
                type="number"
                min={loanRules.minTermDays ?? 1}
                max={loanRules.maxTermDays ?? 180}
                name="term_days"
                required
                readOnly={termFixed}
                value={termDays}
                onChange={(e) => setTermDays(e.target.value)}
                className={`${termFixed ? INPUT_READONLY : INPUT} font-mono tabular-nums`}
              />
            </label>

            <label className="block space-y-1.5">
              <span className={`block ${LABEL}`}>{tn.issueDate}</span>
              <input
                type="date"
                name="issue_date"
                value={issueDate}
                readOnly
                className={`${INPUT_READONLY} font-mono`}
              />
            </label>
          </div>

          <div className="space-y-1">
            {termFixed && loanRules.jurisdictionName ? (
              <p className={HINT}>
                {t.jurisdiction.termFixed
                  .replace('{days}', defaultTerm)
                  .replace('{name}', loanRules.jurisdictionName)}
              </p>
            ) : null}
            <p className={HINT}>{selectedRateDescription ?? tn.manageRatesHint}</p>
            {overCap && rateCap != null ? (
              <p className="text-[13px] font-semibold text-danger">
                {t.jurisdiction.errors.jurisdiction_rate_cap.replace(
                  '{value}',
                  `${(rateCap * 100).toFixed(2)}%`,
                )}
              </p>
            ) : null}
            {state.fieldErrors?.principal ? (
              <p className="text-[13px] font-semibold text-danger">
                {tn.principalMinHint.replace(
                  '{amount}',
                  minLoanAmount != null ? `$${minLoanAmount.toFixed(2)}` : '',
                )}
              </p>
            ) : null}
          </div>
        </div>

        {/* b. Summary */}
        <dl className="space-y-4 p-5 text-sm">
          <div>
            <dt className={LABEL}>{tn.collateralValue}</dt>
            <dd className="mt-1 flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono text-lg font-semibold tabular-nums text-foreground">
                {fmtMoney(collateralValue)}
              </span>
              <span className="text-muted">{itemsText}</span>
            </dd>
            {ltvState !== 'neutral' ? (
              <dd
                className={`mt-0.5 text-[13px] font-semibold ${
                  ltvState === 'ok' ? 'text-success' : 'text-warning'
                }`}
              >
                {ltvState === 'ok'
                  ? `✓ ${tn.ltvCovered.replace('{pct}', String(ltvPct))}`
                  : `⚠ ${tn.ltvOver}`}
              </dd>
            ) : null}
          </div>
          <div>
            <dt className={LABEL}>{tn.interest}</dt>
            <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-foreground">
              {fmtMoney(interest)}
            </dd>
          </div>
          <div>
            <dt className={LABEL}>
              {tn.dueDate} <span className="normal-case tracking-normal">{tn.dueDateAuto}</span>
            </dt>
            <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-foreground">
              {computedDueDate || '—'}
            </dd>
          </div>
        </dl>

        {/* c. Total + actions */}
        <div className="space-y-3 p-5">
          <div>
            <div className={LABEL}>{tn.redemptionLabel}</div>
            <div className="mt-1 font-mono text-[40px] font-bold leading-tight tabular-nums text-foreground">
              {fmtMoney(redemption)}
            </div>
          </div>

          <StaleSpotConfirm
            freshness={spotFreshness}
            canConfirm={canConfirmStale}
            checked={staleAck}
            onChange={setStaleAck}
          />

          <button
            type="submit"
            disabled={!canIssue}
            className={`${PRIMARY_BTN} h-14 w-full text-base`}
          >
            <CheckCircle size={18} weight="bold" />
            {pending ? tn.submitting : tn.submit}
          </button>

          {/* Save as draft — only requires a customer; stages everything else. */}
          <button
            type="button"
            onClick={onSaveDraft}
            disabled={savingDraft || selectedCustomerId == null}
            className={`${OUTLINE_BTN} w-full`}
          >
            <FloppyDisk size={16} weight="bold" />
            {savingDraft ? tn.draftSaving : tn.saveDraft}
          </button>

          {/* Move this ticket to an iPad / phone / laptop with a QR code. */}
          {!isPurchase ? (
            <DraftHandoffButton
              formId={PAWN_NEW_FORM_ID}
              disabled={selectedCustomerId == null}
              className={`${OUTLINE_BTN} w-full`}
              onDraftSaved={setSavedDraftId}
              onMoved={onMoved}
            />
          ) : null}

          {!canIssue && !pending ? (
            <p className={`${HINT} text-center`}>{tn.railMissingHint}</p>
          ) : null}
        </div>
      </section>
      </>
      )}
    </form>
  )
}
