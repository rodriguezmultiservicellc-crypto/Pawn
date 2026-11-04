'use client'

import { useActionState, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Calculator,
  CashRegister,
  CheckCircle,
  Coins,
  LinkBreak,
  Package,
  Plus,
  Trash,
  Warning,
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
import CustomerPicker from '@/components/customers/CustomerPicker'
import {
  AddInventoryItemDialog,
  type InventoryPickRow,
} from '@/components/pos/AddInventoryItemDialog'
import type { SpotFreshness } from '@/lib/spot-prices/staleness'
import {
  PURITIES_BY_METAL,
  SPOT_METALS,
  meltMetalFromItem,
  purityFromItem,
} from '@/lib/spot-prices/purity'
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
import { r4 } from '@/lib/pos/cart'
import { ruleErrorText } from '@/lib/jurisdictions/messages'
import type { MetalPurity, MetalType } from '@/types/database-aliases'
import { createMetalSaleAction, type CreateMetalSaleState } from './actions'

/** Inventory rows the page preloads — the POS picker shape plus metal facts. */
export type MetalPickRow = InventoryPickRow & {
  metal: MetalType | null
  karat: string | null
  weight_grams: number | null
}

type Line = {
  uid: string
  description: string
  /** Description still follows metal + purity (operator hasn't typed one). */
  descriptionAuto: boolean
  metal: MetalType
  purity: MetalPurity
  weight_grams: string
  price: string
  mode: EntryMode
  /** Weight mode only: price still tracks grams × sell rate. */
  priceAuto: boolean
  inventory_item_id: string | null
  sku: string | null
}

type SellPaymentMethod = 'cash' | 'transfer' | 'check' | 'mixed'
const SELL_PAYMENT_METHODS: readonly SellPaymentMethod[] = ['cash', 'transfer', 'check', 'mixed']
function isSellPaymentMethod(v: string): v is SellPaymentMethod {
  return (SELL_PAYMENT_METHODS as readonly string[]).includes(v)
}

let lineSeq = 1
function blankLine(): Line {
  return {
    uid: `l${lineSeq++}`,
    description: '',
    descriptionAuto: true,
    metal: 'gold',
    purity: '14k',
    weight_grams: '',
    price: '',
    mode: 'weight',
    priceAuto: true,
    inventory_item_id: null,
    sku: null,
  }
}

export default function SellMetalForm({
  rates,
  inventory,
  registerOpen,
  showBuyTab,
  spotFreshness,
  canConfirmStale,
}: {
  rates: RateMaps
  inventory: MetalPickRow[]
  registerOpen: boolean
  showBuyTab: boolean
  spotFreshness: SpotFreshness
  canConfirmStale: boolean
}) {
  const { t } = useI18n()
  const s = t.buy.sell
  const [state, formAction, pending] = useActionState<CreateMetalSaleState, FormData>(
    createMetalSaleAction,
    {},
  )

  const [staleAck, setStaleAck] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<SellPaymentMethod>('cash')
  const [paidCash, setPaidCash] = useState('')
  const [paidTransfer, setPaidTransfer] = useState('')
  const [counterparty, setCounterparty] = useState('')
  const [taxPct, setTaxPct] = useState('0')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<Line[]>(() => {
    const l = blankLine()
    return [
      {
        ...l,
        description: `${t.spotPrices.metals[l.metal] ?? l.metal} ${t.spotPrices.purities[l.purity] ?? l.purity} ${s.scrapWord}`,
      },
    ]
  })
  const [pickerOpen, setPickerOpen] = useState(false)
  const [formGen, setFormGen] = useState(0)

  // Validation echo — compute-during-render (Session 8 rule).
  const [lastState, setLastState] = useState(state)
  if (state !== lastState) {
    setLastState(state)
    if (state.values) {
      const pm = state.values.payment_method
      if (pm && isSellPaymentMethod(pm)) setPaymentMethod(pm)
      if (state.values.notes != null) setNotes(state.values.notes)
      if (state.values.counterparty_name != null) setCounterparty(state.values.counterparty_name)
      if (state.values.paid_cash != null) setPaidCash(state.values.paid_cash)
      if (state.values.paid_transfer != null) setPaidTransfer(state.values.paid_transfer)
      if (state.values.tax_pct != null) setTaxPct(state.values.tax_pct)
      setFormGen((g) => g + 1)
    }
  }

  const metalLabel = (m: MetalType) => t.spotPrices.metals[m] ?? m
  const purityLabel = (p: MetalPurity) => t.spotPrices.purities[p] ?? p

  function rateFor(line: Pick<Line, 'metal' | 'purity'>): ResolvedRate {
    return resolveRate(rates, line.metal, line.purity, 'sell')
  }

  function autoDescription(line: Pick<Line, 'metal' | 'purity'>): string {
    return `${metalLabel(line.metal)} ${purityLabel(line.purity)} ${s.scrapWord}`
  }

  /** Same two-way rules as the buy side, at the SELL rate. */
  function derive(line: Line, changed: 'weight' | 'price' | 'rate' | 'mode'): Line {
    let next = line
    if (changed === 'rate' && line.descriptionAuto && !line.inventory_item_id) {
      next = { ...next, description: autoDescription(next) }
    }
    const { perGram } = rateFor(next)
    if (next.mode === 'weight') {
      if (changed === 'price') return { ...next, priceAuto: false }
      if (!next.priceAuto && changed !== 'weight') return next
      const g = parseNum(next.weight_grams)
      if (perGram == null || g == null || g <= 0) {
        return changed === 'weight' ? { ...next, price: '', priceAuto: true } : next
      }
      return { ...next, price: money2(dollarsFromGrams(g, perGram)), priceAuto: true }
    }
    const d = parseNum(next.price)
    if (perGram == null || d == null || d <= 0) {
      return changed === 'price' && d == null ? { ...next, weight_grams: '' } : next
    }
    const g = gramsFromDollars(d, perGram)
    return { ...next, weight_grams: g == null ? next.weight_grams : grams3(g), priceAuto: false }
  }

  function patchLine(uid: string, patch: Partial<Line>, changed?: 'weight' | 'price' | 'rate' | 'mode') {
    setLines((rows) =>
      rows.map((r) => {
        if (r.uid !== uid) return r
        let next = { ...r, ...patch }
        // Changing the metal may invalidate the purity — snap to the first bucket.
        if (patch.metal && !PURITIES_BY_METAL[next.metal]?.includes(next.purity)) {
          next = { ...next, purity: PURITIES_BY_METAL[next.metal]?.[0] ?? '14k' }
        }
        return changed ? derive(next, changed) : next
      }),
    )
  }
  function addLine() {
    setLines((rows) => {
      const l = blankLine()
      return [...rows, { ...l, description: autoDescription(l) }]
    })
  }
  function removeLine(uid: string) {
    setLines((rows) => (rows.length > 1 ? rows.filter((r) => r.uid !== uid) : rows))
  }
  function addFromInventory(pick: InventoryPickRow) {
    const item = inventory.find((i) => i.id === pick.id)
    if (!item) return
    const metal = meltMetalFromItem(item.metal) ?? 'gold'
    const purity =
      (item.metal ? purityFromItem({ metal: item.metal, karat: item.karat }) : null) ??
      PURITIES_BY_METAL[metal]?.[0] ??
      '14k'
    const base: Line = {
      ...blankLine(),
      description: item.description,
      descriptionAuto: false,
      metal,
      purity,
      weight_grams: item.weight_grams != null ? grams3(item.weight_grams) : '',
      inventory_item_id: item.id,
      sku: item.sku,
    }
    const withPrice = derive(base, 'weight')
    setLines((rows) => {
      // Replace a still-empty first line instead of leaving it dangling.
      const onlyBlank =
        rows.length === 1 && !rows[0].weight_grams && !rows[0].price && !rows[0].inventory_item_id
      return onlyBlank ? [withPrice] : [...rows, withPrice]
    })
  }

  const linkedIds = new Set(lines.map((l) => l.inventory_item_id).filter((x): x is string => !!x))
  const pickable = inventory.filter((i) => !linkedIds.has(i.id))

  const metalLines = useMemo(
    () =>
      lines.map((l) => ({
        metal: l.metal as MetalType | null,
        purity: l.purity as MetalPurity | null,
        grams: parseNum(l.weight_grams),
        dollars: parseNum(l.price),
      })),
    [lines],
  )
  const subtotal = sumDollars(metalLines)
  const totalGrams = sumGrams(metalLines)
  const taxRate = Math.max(0, (parseNum(taxPct) ?? 0) / 100)
  const tax = r4(subtotal * taxRate)
  const total = r4(subtotal + tax)
  const groups = useMemo(() => totalsByPurity(metalLines), [metalLines])

  const fieldError = (key: string) => state.fieldErrors?.[key]

  const staleBlocked =
    spotFreshness.stale && lines.length > 0 && !(canConfirmStale && staleAck)
  const mixedBlocked = paymentMethod === 'mixed' && !mixedSplitOk(total, paidCash, paidTransfer)

  const submitLabel = (lines.length === 1 ? s.submitOne : s.submitMany)
    .replace('{count}', String(lines.length))
    .replace('{amount}', formatMoney(total))

  return (
    <div className="space-y-6">
      <StalePriceBanner freshness={spotFreshness} />
      <MetalCounterTabs active="sell" showBuy={showBuyTab} />

      <div>
        <h1 className="font-display flex items-center gap-2 text-2xl font-bold">
          <Coins size={22} weight="bold" />
          {s.title}
        </h1>
        <p className="text-sm text-muted">{s.subtitle}</p>
      </div>

      <div
        className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${
          registerOpen
            ? 'border-border bg-card text-muted'
            : 'border-warning/30 bg-warning/5 text-foreground'
        }`}
      >
        <CashRegister size={14} weight="bold" className="mt-0.5 shrink-0" />
        <span>{registerOpen ? s.registerAttached : s.registerNone}</span>
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
        {/* Buyer */}
        <fieldset className="rounded-xl border border-border bg-card p-4">
          <legend className="px-1 text-sm font-semibold text-foreground">{s.buyer}</legend>
          <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <CustomerPicker
                name="customer_id"
                error={fieldError('customer_id')}
                initialCustomerId={state.values?.customer_id ?? null}
              />
            </div>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-foreground">{s.counterpartyName}</span>
              <input
                name="counterparty_name"
                value={counterparty}
                onChange={(e) => setCounterparty(e.target.value)}
                placeholder={s.counterpartyPlaceholder}
                maxLength={200}
                className={`block w-full rounded-md border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-blue/10 ${
                  fieldError('counterparty_name')
                    ? 'border-danger focus:border-danger'
                    : 'border-border focus:border-blue'
                }`}
              />
              {fieldError('counterparty_name') ? (
                <span className="text-[11px] text-danger">
                  {ruleErrorText(t, fieldError('counterparty_name') ?? '')}
                </span>
              ) : null}
            </label>
          </div>
          <p className="mt-2 text-[11px] text-muted">{s.buyerHelp}</p>
        </fieldset>

        {/* Lines */}
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-foreground">
            {s.lines.replace('{count}', String(lines.length))}
          </legend>
          <input type="hidden" name="line_count" value={lines.length} />

          {lines.map((line, idx) => (
            <LineCard
              key={line.uid}
              line={line}
              idx={idx}
              fieldError={fieldError}
              onPatch={(patch, changed) => patchLine(line.uid, patch, changed)}
              onRemove={() => removeLine(line.uid)}
              canRemove={lines.length > 1}
              rate={rateFor(line)}
            />
          ))}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={addLine}
              disabled={lines.length >= 60}
              className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-3 py-2 text-sm text-foreground hover:bg-background disabled:opacity-50"
            >
              <Plus size={14} weight="bold" />
              {s.addLine}
            </button>
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              disabled={lines.length >= 60 || pickable.length === 0}
              title={pickable.length === 0 ? s.inventoryEmpty : undefined}
              className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-3 py-2 text-sm text-foreground hover:bg-background disabled:opacity-50"
            >
              <Package size={14} weight="bold" />
              {s.addFromInventory}
            </button>
          </div>
        </fieldset>

        {/* Totals + payment */}
        <fieldset className="rounded-xl border border-border bg-card p-4">
          <legend className="px-1 text-sm font-semibold text-foreground">{s.totalsTitle}</legend>
          <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-5">
            <Stat label={s.totalGrams} value={`${totalGrams.toFixed(3)} g`} />
            <Stat label={s.subtotal} value={formatMoney(subtotal)} />
            <label className="block space-y-1">
              <span className="text-xs uppercase tracking-wide text-muted">{s.taxRate}</span>
              <input
                name="tax_pct"
                type="number"
                step="0.001"
                min="0"
                max="100"
                inputMode="decimal"
                value={taxPct}
                onChange={(e) => setTaxPct(e.target.value)}
                className="block w-full rounded-md border border-border bg-card px-2 py-1.5 text-right font-mono text-sm text-foreground focus:border-blue focus:outline-none"
              />
              <input type="hidden" name="tax_rate" value={taxRate.toFixed(6)} />
              <span className="block text-[10px] text-muted">
                {s.tax}: <span className="font-mono text-foreground">{formatMoney(tax)}</span>
              </span>
            </label>
            <Stat label={s.total} value={formatMoney(total)} highlight />
            <label className="block space-y-1">
              <span className="text-xs uppercase tracking-wide text-muted">{s.paymentMethod}</span>
              <select
                name="payment_method"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as SellPaymentMethod)}
                className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
              >
                <option value="cash">{t.pos.payment.methodCash}</option>
                <option value="transfer">{t.pos.payment.methodTransfer}</option>
                <option value="mixed">{t.buy.form.paymentMixed}</option>
                <option value="check">{t.pos.payment.methodCheck}</option>
              </select>
            </label>
          </div>
          <p className="mt-1 text-[11px] text-muted">{s.taxHelp}</p>

          {paymentMethod === 'mixed' ? (
            <MixedTenderFields
              total={total}
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
                totalDollars={subtotal}
                amountLabel={s.price.replace(' *', '')}
              />
            </div>
          ) : null}

          <label className="mt-3 block space-y-1">
            <span className="text-xs uppercase tracking-wide text-muted">{t.buy.form.notes}</span>
            <textarea
              name="notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
            />
          </label>
        </fieldset>

        <StaleSpotConfirm
          freshness={spotFreshness}
          canConfirm={canConfirmStale}
          checked={staleAck}
          onChange={setStaleAck}
        />

        <p className="text-[11px] text-muted">{s.noPoliceReport}</p>

        <div className="flex items-center justify-end gap-3">
          <Link
            href="/inventory"
            className="rounded-md border border-border px-4 py-2 text-sm text-foreground"
          >
            {t.common.cancel}
          </Link>
          <button
            type="submit"
            disabled={pending || lines.length === 0 || total <= 0 || staleBlocked || mixedBlocked}
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

      {pickerOpen ? (
        <AddInventoryItemDialog
          items={pickable}
          onClose={() => setPickerOpen(false)}
          onPick={addFromInventory}
        />
      ) : null}
    </div>
  )
}

function LineCard({
  line,
  idx,
  fieldError,
  onPatch,
  onRemove,
  canRemove,
  rate,
}: {
  line: Line
  idx: number
  fieldError: (k: string) => string | undefined
  onPatch: (patch: Partial<Line>, changed?: 'weight' | 'price' | 'rate' | 'mode') => void
  onRemove: () => void
  canRemove: boolean
  rate: ResolvedRate
}) {
  const { t } = useI18n()
  const s = t.buy.sell
  const errPrefix = `lines.${idx}.`
  const amountMode = line.mode === 'amount'
  const purities = PURITIES_BY_METAL[line.metal] ?? []
  const metalLabel = t.spotPrices.metals[line.metal] ?? line.metal
  const purityLabel = t.spotPrices.purities[line.purity] ?? line.purity

  const inputClass = (err?: string, extra = '') =>
    `block w-full rounded-md border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-blue/10 ${extra} ${
      err ? 'border-danger focus:border-danger' : 'border-border focus:border-blue'
    }`

  return (
    <article className="rounded-xl border border-border bg-card p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-mono text-foreground">
            {s.line.replace('{n}', String(idx + 1))}
          </span>
          {line.inventory_item_id ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-info/10 px-2 py-0.5 text-[11px] text-info">
              <Package size={11} weight="bold" />
              {s.linkedItem.replace('{sku}', line.sku ?? '')}
              <button
                type="button"
                onClick={() => onPatch({ inventory_item_id: null, sku: null })}
                className="ml-1 inline-flex items-center gap-0.5 hover:underline"
                title={s.unlink}
              >
                <LinkBreak size={11} weight="bold" />
                {s.unlink}
              </button>
            </span>
          ) : null}
        </div>
        {canRemove ? (
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex items-center gap-1 rounded-md border border-danger/30 bg-danger/5 px-2 py-1 text-xs font-medium text-danger hover:bg-danger/10"
          >
            <Trash size={12} weight="bold" />
            {t.buy.form.remove}
          </button>
        ) : null}
      </div>

      <input type="hidden" name={`line_${idx}_inventory_item_id`} value={line.inventory_item_id ?? ''} />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
        <label className="block space-y-1 md:col-span-3">
          <span className="text-xs font-medium text-foreground">{s.description}</span>
          <input
            name={`line_${idx}_description`}
            value={line.description}
            onChange={(e) => onPatch({ description: e.target.value, descriptionAuto: false })}
            required
            maxLength={300}
            className={inputClass(fieldError(`${errPrefix}description`))}
          />
          {fieldError(`${errPrefix}description`) ? (
            <span className="text-[11px] text-danger">{fieldError(`${errPrefix}description`)}</span>
          ) : null}
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-foreground">{s.metal}</span>
          <select
            name={`line_${idx}_metal`}
            value={line.metal}
            onChange={(e) => onPatch({ metal: e.target.value as MetalType }, 'rate')}
            className={inputClass(undefined, 'px-2')}
          >
            {SPOT_METALS.map((m) => (
              <option key={m} value={m}>
                {t.spotPrices.metals[m] ?? m}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-foreground">{s.purity}</span>
          <select
            name={`line_${idx}_purity`}
            value={line.purity}
            onChange={(e) => onPatch({ purity: e.target.value as MetalPurity }, 'rate')}
            className={inputClass(undefined, 'px-2')}
          >
            {purities.map((p) => (
              <option key={p} value={p}>
                {t.spotPrices.purities[p] ?? p}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-foreground">
            {amountMode ? `${s.grams} · ${t.buy.form.calculated}` : s.grams}
          </span>
          <input
            name={`line_${idx}_weight_grams`}
            type="number"
            step="0.001"
            min="0"
            inputMode="decimal"
            value={line.weight_grams}
            onChange={(e) => onPatch({ weight_grams: e.target.value }, 'weight')}
            readOnly={amountMode}
            required
            className={inputClass(
              fieldError(`${errPrefix}weight_grams`),
              amountMode ? 'bg-background/60 font-mono' : 'bg-card font-mono',
            )}
          />
          {fieldError(`${errPrefix}weight_grams`) ? (
            <span className="text-[11px] text-danger">{fieldError(`${errPrefix}weight_grams`)}</span>
          ) : null}
        </label>
      </div>

      <div className="mt-3 rounded-md border border-border bg-background/40 p-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Calculator size={14} weight="bold" className="text-muted" />
            <span className="font-medium text-foreground">{s.rate}:</span>
            {rate.perGram == null || rate.spotPerGram == null ? (
              <span className="text-muted">{s.noSpot}</span>
            ) : (
              <span className="font-mono text-foreground">
                {s.rateLine
                  .replace('{rate}', formatMoney(rate.perGram))
                  .replace('{spot}', formatMoney(rate.spotPerGram))
                  .replace('{pct}', pctLabel(rate.multiplier))}
              </span>
            )}
          </div>
          <div className="flex items-end gap-3">
            <EntryModeToggle
              value={line.mode}
              onChange={(m) => onPatch({ mode: m }, 'mode')}
              disabled={rate.perGram == null}
            />
            <label className="block text-xs">
              <span className="block text-[10px] uppercase tracking-wide text-muted">{s.price}</span>
              <input
                name={`line_${idx}_price`}
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                value={line.price}
                onChange={(e) => onPatch({ price: e.target.value }, 'price')}
                required
                className={`block w-32 rounded-md border bg-card px-2 py-1 text-right font-mono text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-blue/10 ${
                  fieldError(`${errPrefix}price`)
                    ? 'border-danger focus:border-danger'
                    : 'border-border focus:border-blue'
                }`}
              />
            </label>
          </div>
        </div>
        {!rate.configured && rate.spotPerGram != null ? (
          <p className="mt-1 inline-flex items-start gap-1 text-[11px] text-warning">
            <Warning size={12} weight="bold" className="mt-0.5 shrink-0" />
            <span>
              {s.rateUnset.replace('{metal}', metalLabel).replace('{purity}', purityLabel)}{' '}
              <Link href="/inventory/spot-prices" className="underline">
                {t.nav.spotPrices}
              </Link>
            </span>
          </p>
        ) : null}
        <p className="mt-1 text-[11px] text-muted">{amountMode ? s.byAmountHelp : s.byWeightHelp}</p>
        {fieldError(`${errPrefix}price`) ? (
          <p className="mt-1 text-[11px] text-danger">{fieldError(`${errPrefix}price`)}</p>
        ) : null}
      </div>
    </article>
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
      <div className={`mt-0.5 font-mono ${highlight ? 'text-2xl text-foreground' : 'text-sm text-foreground'}`}>
        {value}
      </div>
    </div>
  )
}
