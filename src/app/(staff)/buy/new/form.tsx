'use client'

import { useActionState, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Calculator,
  CheckCircle,
  Coins,
  Plus,
  Trash,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { formatMoney } from '@/lib/format/money'
import StalePriceBanner, {
  StaleSpotConfirm,
} from '@/components/inventory/StalePriceBanner'
import MetalCounterTabs from '@/components/buy/MetalCounterTabs'
import MetalTotalsTable from '@/components/buy/MetalTotalsTable'
import MixedTenderFields, { mixedSplitOk } from '@/components/buy/MixedTenderFields'
import EntryModeToggle, { pctLabel, type EntryMode } from '@/components/buy/EntryModeToggle'
import type { SpotFreshness } from '@/lib/spot-prices/staleness'
import { meltMetalFromItem, purityFromItem } from '@/lib/spot-prices/purity'
import {
  dollarsFromGrams,
  grams3,
  gramsFromDollars,
  money2,
  parseNum,
  resolveRate,
  sumDollars,
  sumGrams,
  totalsByPurity,
  type RateMaps,
  type ResolvedRate,
} from '@/lib/metal-counter/math'
import { ruleErrorText } from '@/lib/jurisdictions/messages'
import CustomerPicker from '@/components/customers/CustomerPicker'
import {
  createBuyOutrightAction,
  type CreateBuyState,
} from './actions'

type ItemRow = {
  uid: string
  description: string
  category: string
  metal: string
  karat: string
  weight_grams: string
  payout: string
  mode: EntryMode
  /** Weight mode only: payout still tracks the melt (operator hasn't typed
   *  a negotiated number). Re-armed whenever the weight is retyped. */
  payoutAuto: boolean
  serial_number: string
  photoFile: File | null
  photoPreview: string | null
}

const CATEGORY_VALUES = [
  'ring',
  'necklace',
  'bracelet',
  'earrings',
  'pendant',
  'chain',
  'watch',
  'coin',
  'bullion',
  'loose_stone',
  'other',
] as const

const METAL_VALUES = [
  '',
  'gold',
  'silver',
  'platinum',
  'palladium',
  'rose_gold',
  'white_gold',
  'other',
] as const

let rowSeq = 1
function blankItem(): ItemRow {
  return {
    uid: `r${rowSeq++}`,
    description: '',
    category: 'other',
    metal: 'gold',
    karat: '14',
    weight_grams: '',
    payout: '',
    mode: 'weight',
    payoutAuto: true,
    serial_number: '',
    photoFile: null,
    photoPreview: null,
  }
}

/** How the shop pays the seller. 'store_credit' writes a credit ledger row
 *  instead of handing over cash (patches/0053); 'mixed' is cash + transfer
 *  split into two tenders by the action (brief Phase 3). */
type BuyPayoutMethod =
  | 'cash'
  | 'transfer'
  | 'card'
  | 'check'
  | 'other'
  | 'store_credit'
  | 'mixed'

const BUY_PAYOUT_METHODS: readonly BuyPayoutMethod[] = [
  'cash',
  'transfer',
  'card',
  'check',
  'other',
  'store_credit',
  'mixed',
]

function isBuyPayoutMethod(v: string): v is BuyPayoutMethod {
  return (BUY_PAYOUT_METHODS as readonly string[]).includes(v)
}

export default function BuyForm({
  rates,
  buyHoldDays,
  storeCreditEnabled = false,
  spotFreshness,
  canConfirmStale,
}: {
  /** Spot per gram + this tenant's pay / sell multipliers (lib/metal-counter/rates). */
  rates: RateMaps
  buyHoldDays: number
  storeCreditEnabled?: boolean
  /** 24h stale-price rule — drives the red banner + manager confirm. */
  spotFreshness: SpotFreshness
  /** owner / manager / chain_admin may confirm issuing at a stale price. */
  canConfirmStale: boolean
}) {
  const { t } = useI18n()
  const f = t.buy.form
  const [state, formAction, pending] = useActionState<CreateBuyState, FormData>(
    createBuyOutrightAction,
    {},
  )

  const [staleAck, setStaleAck] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<BuyPayoutMethod>('cash')
  const [paidCash, setPaidCash] = useState('')
  const [paidTransfer, setPaidTransfer] = useState('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<ItemRow[]>(() => [blankItem()])
  const [formGen, setFormGen] = useState(0)

  // Repopulate scalars on validation echo (item rows are kept intact in
  // local state since they're already client-controlled). Compute-during-
  // render pattern per the Session 8 rule — useEffect+setState would
  // trip react-hooks/set-state-in-effect.
  const [lastState, setLastState] = useState(state)
  if (state !== lastState) {
    setLastState(state)
    if (state.values) {
      if (state.values.payment_method) {
        const pm = state.values.payment_method
        if (isBuyPayoutMethod(pm)) setPaymentMethod(pm)
      }
      if (state.values.notes != null) setNotes(state.values.notes)
      if (state.values.paid_cash != null) setPaidCash(state.values.paid_cash)
      if (state.values.paid_transfer != null) setPaidTransfer(state.values.paid_transfer)
      setFormGen((g) => g + 1)
    }
  }

  /** Pay rate for a row: spot × pay multiplier at its (metal, karat) bucket. */
  function rateForRow(row: Pick<ItemRow, 'metal' | 'karat'>): ResolvedRate & {
    purity: ReturnType<typeof purityFromItem>
  } {
    const meltMetal = meltMetalFromItem(row.metal)
    const purity = meltMetal ? purityFromItem({ metal: row.metal, karat: row.karat }) : null
    return { ...resolveRate(rates, meltMetal, purity, 'pay'), purity }
  }

  /**
   * Two-way entry. In WEIGHT mode the grams drive the payout until the
   * operator types a payout of their own (negotiation); retyping the grams
   * re-arms the auto payout. In AMOUNT mode the dollars drive the grams —
   * "they want $300 for this 14K, how many grams is that?" — and the weight
   * box is read-only.
   */
  function derive(row: ItemRow, changed: 'weight' | 'payout' | 'rate' | 'mode'): ItemRow {
    const { perGram } = rateForRow(row)
    if (row.mode === 'weight') {
      if (changed === 'payout') return { ...row, payoutAuto: false }
      if (!row.payoutAuto && changed !== 'weight') return row
      const g = parseNum(row.weight_grams)
      if (perGram == null || g == null || g <= 0) {
        return changed === 'weight' ? { ...row, payout: '', payoutAuto: true } : row
      }
      return { ...row, payout: money2(dollarsFromGrams(g, perGram)), payoutAuto: true }
    }
    // Amount mode.
    const d = parseNum(row.payout)
    if (perGram == null || d == null || d <= 0) {
      return changed === 'payout' && d == null ? { ...row, weight_grams: '' } : row
    }
    const g = gramsFromDollars(d, perGram)
    return { ...row, weight_grams: g == null ? row.weight_grams : grams3(g), payoutAuto: false }
  }

  function patchItem(
    uid: string,
    patch: Partial<ItemRow>,
    changed?: 'weight' | 'payout' | 'rate' | 'mode',
  ) {
    setItems((rows) =>
      rows.map((r) => {
        if (r.uid !== uid) return r
        const next = { ...r, ...patch }
        return changed ? derive(next, changed) : next
      }),
    )
  }
  function addItem() {
    setItems((rows) => [...rows, blankItem()])
  }
  function removeItem(uid: string) {
    setItems((rows) => (rows.length > 1 ? rows.filter((r) => r.uid !== uid) : rows))
  }

  const metalLines = useMemo(
    () =>
      items.map((r) => {
        const { purity, perGram } = rateForRow(r)
        const meltMetal = meltMetalFromItem(r.metal)
        const grams = parseNum(r.weight_grams)
        return {
          metal: meltMetal,
          purity,
          grams: meltMetal && purity ? grams : null,
          dollars: parseNum(r.payout),
          melt:
            perGram != null && grams != null && grams > 0 ? dollarsFromGrams(grams, perGram) : null,
        }
      }),
    // rates is stable for the life of the page; items is the only input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items],
  )

  const totalPayout = sumDollars(metalLines)
  const totalMelt = useMemo(
    () => metalLines.reduce((s, l) => s + (l.melt ?? 0), 0),
    [metalLines],
  )
  const totalGrams = sumGrams(metalLines)
  const groups = useMemo(() => totalsByPurity(metalLines), [metalLines])

  const fieldError = (key: string) => state.fieldErrors?.[key]

  // Stale guard, client half: mirrors lib/spot-prices/stale-gate. Only a
  // buy that prices precious metal is held; the server re-checks both the
  // staleness and the role on submit.
  const involvesMetal = items.some((r) => meltMetalFromItem(r.metal) != null)
  const staleBlocked =
    spotFreshness.stale && involvesMetal && !(canConfirmStale && staleAck)
  const mixedBlocked =
    paymentMethod === 'mixed' && !mixedSplitOk(totalPayout, paidCash, paidTransfer)

  const submitLabel = (items.length === 1 ? f.submitOne : f.submitMany)
    .replace('{count}', String(items.length))
    .replace('{amount}', formatMoney(totalPayout))

  return (
    <div className="space-y-6">
      <StalePriceBanner freshness={spotFreshness} />
      <MetalCounterTabs
        active="buy"
        right={
          <>
            {f.holdPeriod}: <span className="font-mono text-foreground">{buyHoldDays}d</span>
          </>
        }
      />

      <div>
        <h1 className="font-display flex items-center gap-2 text-2xl font-bold">
          <Coins size={22} weight="bold" />
          {f.title}
        </h1>
        <p className="text-sm text-muted">{f.subtitle.replace('{days}', String(buyHoldDays))}</p>
      </div>

      {state.error ? (
        <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {ruleErrorText(t, state.error)}
        </div>
      ) : state.fieldErrors && Object.keys(state.fieldErrors).length > 0 ? (
        <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {t.common.fixErrorsBelow}
        </div>
      ) : null}

      <form action={formAction} className="space-y-6" key={formGen}>
        {/* Customer */}
        <fieldset className="rounded-xl border border-border bg-card p-4">
          <legend className="px-1 text-sm font-semibold text-foreground">{f.customer}</legend>
          <div className="mt-2 flex items-start gap-2">
            <div className="flex-1">
              <CustomerPicker
                name="customer_id"
                required
                enableDlScan
                error={fieldError('customer_id')}
                initialCustomerId={state.values?.customer_id ?? null}
              />
            </div>
            <Link
              href="/customers/new?return=/buy/new"
              className="shrink-0 rounded-md border border-border bg-card px-3 py-3 text-sm text-foreground hover:bg-background hover:text-foreground"
            >
              {f.newCustomer}
            </Link>
          </div>
          <p className="mt-2 text-[11px] text-muted">{f.customerHelp}</p>
        </fieldset>

        {/* Items */}
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-foreground">
            {f.items.replace('{count}', String(items.length))}
          </legend>
          <input type="hidden" name="item_count" value={items.length} />

          {items.map((row, idx) => (
            <ItemCard
              key={row.uid}
              row={row}
              idx={idx}
              fieldError={fieldError}
              onPatch={(patch, changed) => patchItem(row.uid, patch, changed)}
              onRemove={() => removeItem(row.uid)}
              canRemove={items.length > 1}
              rate={rateForRow(row)}
              melt={metalLines[idx]?.melt ?? null}
            />
          ))}

          <button
            type="button"
            onClick={addItem}
            disabled={items.length >= 20}
            className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-3 py-2 text-sm text-foreground hover:bg-background disabled:opacity-50"
          >
            <Plus size={14} weight="bold" />
            {f.addItem}
          </button>
        </fieldset>

        {/* Totals + payment */}
        <fieldset className="rounded-xl border border-border bg-card p-4">
          <legend className="px-1 text-sm font-semibold text-foreground">{f.totalsTitle}</legend>
          <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-4">
            <Stat label={f.totalMelt} value={formatMoney(totalMelt)} />
            <Stat label={f.totalGrams} value={`${totalGrams.toFixed(3)} g`} />
            <Stat label={f.totalPayout} value={formatMoney(totalPayout)} highlight />
            <label className="block space-y-1">
              <span className="text-xs uppercase tracking-wide text-muted">
                {t.pos.payment.method}
              </span>
              <select
                name="payment_method"
                value={paymentMethod}
                onChange={(e) =>
                  setPaymentMethod(e.target.value as BuyPayoutMethod)
                }
                className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
              >
                <option value="cash">{t.pos.payment.methodCash}</option>
                <option value="transfer">{t.pos.payment.methodTransfer}</option>
                <option value="mixed">{f.paymentMixed}</option>
                <option value="check">{t.pos.payment.methodCheck}</option>
                <option value="card">{t.pos.payment.methodCard}</option>
                <option value="other">{t.pos.payment.methodOther}</option>
                {storeCreditEnabled ? (
                  <option value="store_credit">
                    {t.storeCredit.buyPayout}
                  </option>
                ) : null}
              </select>
              {paymentMethod === 'store_credit' ? (
                <span className="block text-xs text-muted">
                  {t.storeCredit.buyPayoutHelp}
                </span>
              ) : null}
            </label>
          </div>

          {paymentMethod === 'mixed' ? (
            <MixedTenderFields
              total={totalPayout}
              cash={paidCash}
              transfer={paidTransfer}
              onCashChange={setPaidCash}
              onTransferChange={setPaidTransfer}
            />
          ) : null}

          {groups.length > 0 ? (
            <div className="mt-4">
              <MetalTotalsTable
                groups={groups}
                totalGrams={totalGrams}
                totalDollars={totalPayout}
                amountLabel={f.colAmount}
              />
            </div>
          ) : null}

          <label className="mt-3 block space-y-1">
            <span className="text-xs uppercase tracking-wide text-muted">{f.notes}</span>
            <textarea
              name="notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
            />
          </label>
        </fieldset>

        {involvesMetal ? (
          <StaleSpotConfirm
            freshness={spotFreshness}
            canConfirm={canConfirmStale}
            checked={staleAck}
            onChange={setStaleAck}
          />
        ) : null}

        <div className="flex items-center justify-end gap-3">
          <Link
            href="/inventory"
            className="rounded-md border border-border px-4 py-2 text-sm text-foreground"
          >
            {t.common.cancel}
          </Link>
          <button
            type="submit"
            disabled={pending || items.length === 0 || staleBlocked || mixedBlocked}
            className="inline-flex items-center gap-2 rounded-md bg-gold px-4 py-2 text-sm font-medium text-navy hover:bg-gold-2 disabled:opacity-50"
          >
            {pending ? (
              t.common.saving
            ) : (
              <>
                <CheckCircle size={14} weight="bold" />
                {submitLabel}
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  )
}

function ItemCard({
  row,
  idx,
  fieldError,
  onPatch,
  onRemove,
  canRemove,
  rate,
  melt,
}: {
  row: ItemRow
  idx: number
  fieldError: (k: string) => string | undefined
  onPatch: (patch: Partial<ItemRow>, changed?: 'weight' | 'payout' | 'rate' | 'mode') => void
  onRemove: () => void
  canRemove: boolean
  rate: ResolvedRate & { purity: ReturnType<typeof purityFromItem> }
  melt: number | null
}) {
  const { t } = useI18n()
  const f = t.buy.form
  const inv = t.inventory

  const categoryLabel: Record<(typeof CATEGORY_VALUES)[number], string> = {
    ring: inv.catRing,
    necklace: inv.catNecklace,
    bracelet: inv.catBracelet,
    earrings: inv.catEarrings,
    pendant: inv.catPendant,
    chain: inv.catChain,
    watch: inv.catWatch,
    coin: inv.catCoin,
    bullion: inv.catBullion,
    loose_stone: inv.catLooseStone,
    other: inv.catOther,
  }
  const categories = CATEGORY_VALUES.map((v) => ({ value: v, label: categoryLabel[v] }))
  const metals = METAL_VALUES.map((v) => ({
    value: v,
    label: v === '' ? f.metalNone : (t.spotPrices.metals as Record<string, string>)[v] ?? v,
  }))

  const onPhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null
    if (!file) {
      onPatch({ photoFile: null, photoPreview: null })
      return
    }
    const url = URL.createObjectURL(file)
    onPatch({ photoFile: file, photoPreview: url })
  }

  const isOverridden = rate.multiplier !== 1
  const errPrefix = `items.${idx}.`
  const amountMode = row.mode === 'amount'

  const meltHint =
    rate.perGram == null
      ? rate.purity == null
        ? f.meltAddMetal
        : f.meltNoSpot
      : f.meltAddWeight

  return (
    <article className="rounded-xl border border-border bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-mono text-foreground">
          {f.item.replace('{n}', String(idx + 1))}
        </span>
        {canRemove ? (
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex items-center gap-1 rounded-md border border-danger/30 bg-danger/5 px-2 py-1 text-xs font-medium text-danger hover:bg-danger/10"
          >
            <Trash size={12} weight="bold" />
            {f.remove}
          </button>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
        <Field
          name={`item_${idx}_description`}
          label={f.description}
          value={row.description}
          onChange={(v) => onPatch({ description: v })}
          error={fieldError(`${errPrefix}description`)}
          span={3}
          required
        />
        <Select
          name={`item_${idx}_category`}
          label={f.category}
          value={row.category}
          onChange={(v) => onPatch({ category: v })}
          options={categories}
          error={fieldError(`${errPrefix}category`)}
        />
        <Field
          name={`item_${idx}_serial_number`}
          label={f.serial}
          value={row.serial_number}
          onChange={(v) => onPatch({ serial_number: v })}
          span={2}
        />

        <Select
          name={`item_${idx}_metal`}
          label={f.metal}
          value={row.metal}
          onChange={(v) => onPatch({ metal: v }, 'rate')}
          options={metals}
        />
        <Field
          name={`item_${idx}_karat`}
          label={f.karat}
          value={row.karat}
          onChange={(v) => onPatch({ karat: v }, 'rate')}
          placeholder="14"
        />
        <Field
          name={`item_${idx}_weight_grams`}
          label={amountMode ? `${f.weight} · ${f.calculated}` : f.weight}
          value={row.weight_grams}
          onChange={(v) => onPatch({ weight_grams: v }, 'weight')}
          type="number"
          step="0.001"
          placeholder="0.000"
          readOnly={amountMode}
        />
        <div className="md:col-span-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-foreground">{f.photo}</span>
            <input
              type="file"
              name={`item_${idx}_photo`}
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif"
              onChange={onPhotoChange}
              className="block w-full text-xs text-foreground file:mr-2 file:rounded-md file:border-0 file:bg-background file:px-3 file:py-1 file:text-xs file:text-foreground"
            />
          </label>
        </div>
      </div>

      <div className="mt-3 rounded-md border border-border bg-background/40 p-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Calculator size={14} weight="bold" className="text-muted" />
            <span className="font-medium text-foreground">{f.melt}:</span>
            {melt == null ? (
              <span className="text-muted">{meltHint}</span>
            ) : (
              <span className="font-mono text-foreground">{formatMoney(melt)}</span>
            )}
            {isOverridden ? (
              <span className="rounded-md bg-warning/10 px-1.5 py-0.5 font-mono text-[10px] text-warning">
                ×{rate.multiplier.toFixed(4)}
              </span>
            ) : null}
            {rate.purity ? (
              <span className="text-[10px] text-muted">
                ({t.spotPrices.purities[rate.purity] ?? rate.purity})
              </span>
            ) : null}
            {rate.perGram != null && rate.spotPerGram != null ? (
              <span className="font-mono text-[10px] text-muted">
                {f.rateLine
                  .replace('{rate}', formatMoney(rate.perGram))
                  .replace('{spot}', formatMoney(rate.spotPerGram))
                  .replace('{pct}', pctLabel(rate.multiplier))}
              </span>
            ) : null}
          </div>
          <div className="flex items-end gap-3">
            <EntryModeToggle
              value={row.mode}
              onChange={(m) => onPatch({ mode: m }, 'mode')}
              disabled={rate.perGram == null}
            />
            <label className="block text-xs">
              <span className="block text-[10px] uppercase tracking-wide text-muted">
                {f.payout}
              </span>
              <input
                name={`item_${idx}_payout`}
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                value={row.payout}
                onChange={(e) => onPatch({ payout: e.target.value }, 'payout')}
                required
                className={`block w-32 rounded-md border bg-card px-2 py-1 text-right font-mono text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-blue/10 ${
                  fieldError(`${errPrefix}payout`)
                    ? 'border-danger focus:border-danger'
                    : 'border-border focus:border-blue'
                }`}
              />
            </label>
          </div>
        </div>
        <p className="mt-1 text-[11px] text-muted">
          {amountMode ? f.byAmountHelp : f.byWeightHelp}
        </p>
        {fieldError(`${errPrefix}payout`) ? (
          <p className="mt-1 text-[11px] text-danger">
            {fieldError(`${errPrefix}payout`)}
          </p>
        ) : null}
      </div>

      {row.photoPreview ? (
        <div className="mt-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={row.photoPreview}
            alt=""
            className="h-20 w-20 rounded-md border border-border object-cover"
          />
        </div>
      ) : null}
    </article>
  )
}

function Field({
  name,
  label,
  value,
  onChange,
  type = 'text',
  step,
  placeholder,
  error,
  span = 1,
  required,
  readOnly,
}: {
  name: string
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  step?: string
  placeholder?: string
  error?: string
  span?: number
  required?: boolean
  readOnly?: boolean
}) {
  const colSpan =
    span === 2
      ? 'md:col-span-2'
      : span === 3
        ? 'md:col-span-3'
        : ''
  return (
    <label className={`block space-y-1 ${colSpan}`}>
      <span className="text-xs font-medium text-foreground">{label}</span>
      <input
        type={type}
        step={step}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        readOnly={readOnly}
        className={`block w-full rounded-md border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-blue/10 ${
          readOnly ? 'bg-background/60 font-mono' : 'bg-card'
        } ${
          error
            ? 'border-danger focus:border-danger'
            : 'border-border focus:border-blue'
        }`}
      />
      {error ? <span className="text-[11px] text-danger">{error}</span> : null}
    </label>
  )
}

function Select({
  name,
  label,
  value,
  onChange,
  options,
  error,
}: {
  name: string
  label: string
  value: string
  onChange: (v: string) => void
  options: ReadonlyArray<{ value: string; label: string }>
  error?: string
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-foreground">{label}</span>
      <select
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`block w-full rounded-md border bg-card px-2 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-blue/10 ${
          error
            ? 'border-danger focus:border-danger'
            : 'border-border focus:border-blue'
        }`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error ? <span className="text-[11px] text-danger">{error}</span> : null}
    </label>
  )
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div
        className={`mt-0.5 font-mono ${
          highlight ? 'text-2xl text-foreground' : 'text-sm text-foreground'
        }`}
      >
        {value}
      </div>
    </div>
  )
}
