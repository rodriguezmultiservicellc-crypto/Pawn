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
import { PhotoStrip, type StripPhoto } from '@/components/uploads/PhotoStrip'
import { formatMoney } from '@/lib/format/money'
import StalePriceBanner, {
  StaleSpotConfirm,
} from '@/components/inventory/StalePriceBanner'
import MetalCounterTabs from '@/components/buy/MetalCounterTabs'
import MetalTotalsTable from '@/components/buy/MetalTotalsTable'
import MixedTenderFields, { mixedSplitOk } from '@/components/buy/MixedTenderFields'
import BuyPayoutSelect, {
  isBuyPayoutMethod,
  type BuyPayoutMethod,
} from '@/components/buy/BuyPayoutSelect'
import EntryModeToggle, { pctLabel, type EntryMode } from '@/components/buy/EntryModeToggle'
import type { SpotFreshness } from '@/lib/spot-prices/staleness'
import {
  COATINGS,
  isPurityInput,
  isSolidMetal,
  meltMetalFromItem,
  purityAfterMetalChange,
  purityContentRatio,
  purityFromItem,
  type Coating,
} from '@/lib/spot-prices/purity'
import { PurityField } from '@/components/pawn/PurityField'
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
import { PledgorRecordBanner } from '@/components/customers/PledgorRecordBanner'
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
  /** Surface coating (patches/0067). Not 'none' ⇒ no melt, no auto payout. */
  coating: Coating
  weight_grams: string
  payout: string
  mode: EntryMode
  /** Weight mode only: payout still tracks the melt (operator hasn't typed
   *  a negotiated number). Re-armed whenever the weight is retyped. */
  payoutAuto: boolean
  serial_number: string
  /** Photos already uploaded (components/uploads/PhotoStrip), main first. */
  photos: StripPhoto[]
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
    coating: 'none',
    weight_grams: '',
    payout: '',
    mode: 'weight',
    payoutAuto: true,
    serial_number: '',
    photos: [],
  }
}


export default function BuyForm({
  rates,
  buyHoldDays,
  storeCreditEnabled = false,
  spotFreshness,
  canConfirmStale,
  tenantId,
}: {
  /** The shop: item photos upload into its folder. */
  tenantId: string
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
  // The picked seller, for the incomplete-record warning.
  const [sellerId, setSellerId] = useState<string | null>(state.values?.customer_id ?? null)

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
  function rateForRow(row: Pick<ItemRow, 'metal' | 'karat' | 'coating'>): ResolvedRate & {
    purity: ReturnType<typeof purityFromItem>
    coated: boolean
  } {
    // A plated / filled / vermeil / PVD piece has no melt value — the
    // payout is whatever the operator types (brief Phase 4.2).
    const coated = !isSolidMetal(row.coating)
    const meltMetal = coated ? null : meltMetalFromItem(row.metal)
    const purity = meltMetal ? purityFromItem({ metal: row.metal, karat: row.karat }) : null
    const rate = resolveRate(rates, meltMetal, purity, 'pay')
    // Between two buckets (12K, 800 silver): by its metal content, as the
    // pawn ticket and meltValueAtBuy price it.
    const ratio = purity ? purityContentRatio(row.metal, row.karat, purity) : 1
    const perGram = rate.perGram == null ? null : Math.round(rate.perGram * ratio * 10000) / 10000
    return { ...rate, perGram, purity, coated }
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
  const involvesMetal = items.some(
    (r) => meltMetalFromItem(r.metal) != null && isSolidMetal(r.coating),
  )
  // A purity the metal cannot have (28K, 925 on gold) stops the buy.
  const purityBlocked = items.some((r) => !isPurityInput(r.metal, r.karat))
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
                onChange={(c) => setSellerId(c?.id ?? null)}
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
          <div className="mt-2">
            <PledgorRecordBanner customerId={sellerId} />
          </div>
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
              tenantId={tenantId}
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
            <BuyPayoutSelect
              value={paymentMethod}
              onChange={setPaymentMethod}
              storeCreditEnabled={storeCreditEnabled}
            />
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
            disabled={pending || items.length === 0 || staleBlocked || mixedBlocked || purityBlocked}
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
  tenantId,
  fieldError,
  onPatch,
  onRemove,
  canRemove,
  rate,
  melt,
}: {
  row: ItemRow
  idx: number
  tenantId: string
  fieldError: (k: string) => string | undefined
  onPatch: (patch: Partial<ItemRow>, changed?: 'weight' | 'payout' | 'rate' | 'mode') => void
  onRemove: () => void
  canRemove: boolean
  rate: ResolvedRate & { purity: ReturnType<typeof purityFromItem>; coated: boolean }
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

  const isOverridden = rate.multiplier !== 1
  const errPrefix = `items.${idx}.`
  const amountMode = row.mode === 'amount'

  const meltHint = rate.coated
    ? f.meltCoated
    : rate.perGram == null
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
          onChange={(v) =>
            onPatch({ metal: v, karat: purityAfterMetalChange(row.metal, v, row.karat) }, 'rate')
          }
          options={metals}
        />
        {/* Karat for gold, parts per thousand for silver / platinum, none
            for steel — the same field as the pawn ticket's. */}
        <PurityField
          metal={row.metal}
          name={`item_${idx}_karat`}
          value={row.karat}
          onChange={(v) => onPatch({ karat: v }, 'rate')}
          labelClassName="block text-xs font-medium text-foreground"
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
        <Select
          name={`item_${idx}_coating`}
          label={f.coating}
          value={row.coating}
          onChange={(v) => onPatch({ coating: v as Coating, mode: 'weight' }, 'rate')}
          options={COATINGS.map((c) => ({ value: c, label: t.inventory.coatings[c] }))}
        />
        {/* Photos — uploaded as they are picked; the form carries their
            paths (components/uploads/PhotoStrip). */}
        <div className="md:col-span-2">
          <PhotoStrip
            tenantId={tenantId}
            bucket="inventory-photos"
            name={`item_${idx}_photos`}
            photos={row.photos}
            onChange={(photos) => onPatch({ photos })}
            label={f.photo}
          />
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
        <p className={`mt-1 text-[11px] ${rate.coated ? 'font-medium text-warning' : 'text-muted'}`}>
          {rate.coated ? t.inventory.coatingWarning : amountMode ? f.byAmountHelp : f.byWeightHelp}
        </p>
        {fieldError(`${errPrefix}payout`) ? (
          <p className="mt-1 text-[11px] text-danger">
            {fieldError(`${errPrefix}payout`)}
          </p>
        ) : null}
      </div>

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
