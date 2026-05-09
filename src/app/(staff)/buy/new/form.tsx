'use client'

import {
  useActionState,
  useMemo,
  useState,
} from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  Calculator,
  CheckCircle,
  Coins,
  Plus,
  Trash,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import CustomerPicker from '@/components/customers/CustomerPicker'
import {
  createBuyOutrightAction,
  type CreateBuyState,
} from './actions'

export type SpotPriceMap = Record<string, number>
export type OverrideMap = Record<string, number>

type ItemRow = {
  uid: string
  description: string
  category: string
  metal: string
  karat: string
  weight_grams: string
  payout: string
  /** Operator hasn't manually edited the payout — keep auto-syncing it
   *  to the suggested melt-based value. Once they type something, this
   *  flips to false and we stop overwriting. */
  payoutAuto: boolean
  serial_number: string
  photoFile: File | null
  photoPreview: string | null
}

const CATEGORIES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'ring', label: 'Ring' },
  { value: 'necklace', label: 'Necklace' },
  { value: 'bracelet', label: 'Bracelet' },
  { value: 'earrings', label: 'Earrings' },
  { value: 'pendant', label: 'Pendant' },
  { value: 'chain', label: 'Chain' },
  { value: 'watch', label: 'Watch' },
  { value: 'coin', label: 'Coin' },
  { value: 'bullion', label: 'Bullion' },
  { value: 'loose_stone', label: 'Loose stone' },
  { value: 'other', label: 'Other' },
]

const METALS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: '—' },
  { value: 'gold', label: 'Gold' },
  { value: 'silver', label: 'Silver' },
  { value: 'platinum', label: 'Platinum' },
  { value: 'palladium', label: 'Palladium' },
  { value: 'rose_gold', label: 'Rose gold' },
  { value: 'white_gold', label: 'White gold' },
  { value: 'other', label: 'Other' },
]

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
    payoutAuto: true,
    serial_number: '',
    photoFile: null,
    photoPreview: null,
  }
}

function purityFromKarat(metal: string, karat: string): string | null {
  if (
    metal === 'silver' ||
    metal === 'sterling' ||
    metal === 'sterling_925'
  ) {
    return 'sterling_925'
  }
  if (metal === 'platinum') return 'platinum_950'
  if (metal === 'palladium') return 'palladium_950'
  if (metal === 'gold' || metal === 'rose_gold' || metal === 'white_gold') {
    const k = parseFloat(karat)
    if (!isFinite(k)) return null
    if (k >= 23.5) return 'pure_24k'
    if (k >= 21) return '22k'
    if (k >= 16) return '18k'
    if (k >= 12) return '14k'
    if (k >= 8) return '10k'
    return null
  }
  return null
}

function meltMetalFromMetal(metal: string): string | null {
  if (!metal) return null
  if (metal === 'gold' || metal === 'rose_gold' || metal === 'white_gold') return 'gold'
  if (metal === 'silver' || metal === 'platinum' || metal === 'palladium') return metal
  return null
}

function fmt(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  })
}

export default function BuyForm({
  spotPriceMap,
  overrideMap,
  buyHoldDays,
}: {
  spotPriceMap: SpotPriceMap
  overrideMap: OverrideMap
  buyHoldDays: number
}) {
  const { t } = useI18n()
  const [state, formAction, pending] = useActionState<CreateBuyState, FormData>(
    createBuyOutrightAction,
    {},
  )

  const [paymentMethod, setPaymentMethod] = useState<
    'cash' | 'card' | 'check' | 'other'
  >('cash')
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
        if (pm === 'cash' || pm === 'card' || pm === 'check' || pm === 'other') {
          setPaymentMethod(pm)
        }
      }
      if (state.values.notes != null) setNotes(state.values.notes)
      setFormGen((g) => g + 1)
    }
  }

  function patchItem(uid: string, patch: Partial<ItemRow>) {
    setItems((rows) =>
      rows.map((r) => (r.uid === uid ? { ...r, ...patch } : r)),
    )
  }
  function addItem() {
    setItems((rows) => [...rows, blankItem()])
  }
  function removeItem(uid: string) {
    setItems((rows) => (rows.length > 1 ? rows.filter((r) => r.uid !== uid) : rows))
  }

  function meltForItem(row: ItemRow): {
    perGram: number | null
    multiplier: number
    meltValue: number | null
    purity: string | null
  } {
    const meltMetal = meltMetalFromMetal(row.metal)
    const purity = meltMetal ? purityFromKarat(row.metal, row.karat) : null
    if (!meltMetal || !purity) {
      return { perGram: null, multiplier: 1, meltValue: null, purity: null }
    }
    const key = `${meltMetal}::${purity}`
    const perGram = spotPriceMap[key] ?? null
    const multiplier = overrideMap[key] ?? 1
    const grams = parseFloat(row.weight_grams)
    if (perGram == null || !isFinite(grams) || grams <= 0) {
      return { perGram, multiplier, meltValue: null, purity }
    }
    const meltValue = perGram * multiplier * grams
    return { perGram, multiplier, meltValue, purity }
  }

  // Auto-sync the operator's payout to the computed melt as long as
  // they haven't typed in the field. Once they do, payoutAuto flips
  // false and we stop overwriting their value. Compute-during-render
  // pattern per Session 8 — driven off a signature of the inputs that
  // affect the computed melt; the conditional setItems only fires when
  // the signature actually changes.
  const meltSignature = items
    .map((r) => `${r.uid}:${r.metal}:${r.karat}:${r.weight_grams}`)
    .join('|')
  const [lastMeltSig, setLastMeltSig] = useState(meltSignature)
  if (meltSignature !== lastMeltSig) {
    setLastMeltSig(meltSignature)
    setItems((rows) =>
      rows.map((r) => {
        if (!r.payoutAuto) return r
        const { meltValue } = meltForItem(r)
        const next =
          meltValue == null
            ? ''
            : (Math.round(meltValue * 100) / 100).toFixed(2)
        if (r.payout === next) return r
        return { ...r, payout: next }
      }),
    )
  }

  const totalPayout = useMemo(() => {
    return items.reduce((s, r) => {
      const n = parseFloat(r.payout)
      return s + (isFinite(n) ? n : 0)
    }, 0)
  }, [items])

  const totalMelt = useMemo(() => {
    return items.reduce((s, r) => {
      const m = meltForItem(r).meltValue
      return s + (m ?? 0)
    }, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])

  const fieldError = (key: string) => state.fieldErrors?.[key]

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/inventory"
            className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
          >
            <ArrowLeft size={14} weight="bold" />
            {t.inventory.backToList}
          </Link>
        </div>
        <div className="text-xs text-muted">
          Hold period: <span className="font-mono text-foreground">{buyHoldDays}d</span>
        </div>
      </header>

      <div>
        <h1 className="font-display flex items-center gap-2 text-2xl font-bold">
          <Coins size={22} weight="bold" />
          Buy gold (outright)
        </h1>
        <p className="text-sm text-muted">
          Buy items from a customer for cash. Each item enters inventory
          marked status=held for {buyHoldDays} days, then becomes available
          for sale. A police-report compliance row is written automatically.
        </p>
      </div>

      {state.error ? (
        <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {state.error}
        </div>
      ) : state.fieldErrors && Object.keys(state.fieldErrors).length > 0 ? (
        <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {t.common.fixErrorsBelow}
        </div>
      ) : null}

      <form action={formAction} className="space-y-6" key={formGen}>
        {/* Customer */}
        <fieldset className="rounded-xl border border-border bg-card p-4">
          <legend className="px-1 text-sm font-semibold text-foreground">
            Customer
          </legend>
          <div className="mt-2 flex items-start gap-2">
            <div className="flex-1">
              <CustomerPicker
                name="customer_id"
                required
                error={fieldError('customer_id')}
                initialCustomerId={state.values?.customer_id ?? null}
              />
            </div>
            <Link
              href="/customers/new?return=/buy/new"
              className="shrink-0 rounded-md border border-border bg-card px-3 py-3 text-sm text-foreground hover:bg-background hover:text-foreground"
            >
              + New
            </Link>
          </div>
          <p className="mt-2 text-[11px] text-muted">
            Customer must be in this tenant&apos;s records (FL pawn law
            requires customer ID for buy-outright).
          </p>
        </fieldset>

        {/* Items */}
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-foreground">
            Items ({items.length})
          </legend>
          <input type="hidden" name="item_count" value={items.length} />

          {items.map((row, idx) => (
            <ItemCard
              key={row.uid}
              row={row}
              idx={idx}
              fieldError={fieldError}
              onChange={(patch) => patchItem(row.uid, patch)}
              onRemove={() => removeItem(row.uid)}
              canRemove={items.length > 1}
              meltInfo={meltForItem(row)}
            />
          ))}

          <button
            type="button"
            onClick={addItem}
            disabled={items.length >= 20}
            className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-3 py-2 text-sm text-foreground hover:bg-background disabled:opacity-50"
          >
            <Plus size={14} weight="bold" />
            Add item
          </button>
        </fieldset>

        {/* Totals + payment */}
        <fieldset className="rounded-xl border border-border bg-card p-4">
          <legend className="px-1 text-sm font-semibold text-foreground">
            Payout
          </legend>
          <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-3">
            <Stat label="Total melt" value={fmt(totalMelt)} />
            <Stat label="Total payout" value={fmt(totalPayout)} highlight />
            <label className="block space-y-1">
              <span className="text-xs uppercase tracking-wide text-muted">
                Payment method
              </span>
              <select
                name="payment_method"
                value={paymentMethod}
                onChange={(e) =>
                  setPaymentMethod(
                    e.target.value as 'cash' | 'card' | 'check' | 'other',
                  )
                }
                className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
              >
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="check">Check</option>
                <option value="other">Other</option>
              </select>
            </label>
          </div>
          <label className="mt-3 block space-y-1">
            <span className="text-xs uppercase tracking-wide text-muted">
              Notes
            </span>
            <textarea
              name="notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
            />
          </label>
        </fieldset>

        <div className="flex items-center justify-end gap-3">
          <Link
            href="/inventory"
            className="rounded-md border border-border px-4 py-2 text-sm text-foreground"
          >
            {t.common.cancel}
          </Link>
          <button
            type="submit"
            disabled={pending || items.length === 0}
            className="inline-flex items-center gap-2 rounded-md bg-gold px-4 py-2 text-sm font-medium text-navy hover:bg-gold-2 disabled:opacity-50"
          >
            {pending ? (
              t.common.saving
            ) : (
              <>
                <CheckCircle size={14} weight="bold" />
                Buy {items.length} item{items.length === 1 ? '' : 's'} —{' '}
                {fmt(totalPayout)}
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
  onChange,
  onRemove,
  canRemove,
  meltInfo,
}: {
  row: ItemRow
  idx: number
  fieldError: (k: string) => string | undefined
  onChange: (patch: Partial<ItemRow>) => void
  onRemove: () => void
  canRemove: boolean
  meltInfo: {
    perGram: number | null
    multiplier: number
    meltValue: number | null
    purity: string | null
  }
}) {
  const onPhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null
    if (!file) {
      onChange({ photoFile: null, photoPreview: null })
      return
    }
    const url = URL.createObjectURL(file)
    onChange({ photoFile: file, photoPreview: url })
  }

  const isOverridden = meltInfo.multiplier !== 1
  const errPrefix = `items.${idx}.`

  return (
    <article className="rounded-xl border border-border bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-mono text-foreground">
          Item {idx + 1}
        </span>
        {canRemove ? (
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex items-center gap-1 rounded-md border border-danger/30 bg-danger/5 px-2 py-1 text-xs font-medium text-danger hover:bg-danger/10"
          >
            <Trash size={12} weight="bold" />
            Remove
          </button>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
        <Field
          name={`item_${idx}_description`}
          label="Description *"
          value={row.description}
          onChange={(v) => onChange({ description: v })}
          error={fieldError(`${errPrefix}description`)}
          span={3}
          required
        />
        <Select
          name={`item_${idx}_category`}
          label="Category"
          value={row.category}
          onChange={(v) => onChange({ category: v })}
          options={CATEGORIES}
          error={fieldError(`${errPrefix}category`)}
        />
        <Field
          name={`item_${idx}_serial_number`}
          label="Serial / engraving"
          value={row.serial_number}
          onChange={(v) => onChange({ serial_number: v })}
          span={2}
        />

        <Select
          name={`item_${idx}_metal`}
          label="Metal"
          value={row.metal}
          onChange={(v) => onChange({ metal: v })}
          options={METALS}
        />
        <Field
          name={`item_${idx}_karat`}
          label="Karat"
          value={row.karat}
          onChange={(v) => onChange({ karat: v })}
          placeholder="14"
        />
        <Field
          name={`item_${idx}_weight_grams`}
          label="Weight (g)"
          value={row.weight_grams}
          onChange={(v) => onChange({ weight_grams: v })}
          type="number"
          step="0.01"
          placeholder="0.00"
        />
        <div className="md:col-span-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-foreground">Photo</span>
            <input
              type="file"
              name={`item_${idx}_photo`}
              accept="image/jpeg,image/png,image/webp,image/heic"
              onChange={onPhotoChange}
              className="block w-full text-xs text-foreground file:mr-2 file:rounded-md file:border-0 file:bg-background file:px-3 file:py-1 file:text-xs file:text-foreground"
            />
          </label>
        </div>
      </div>

      <div className="mt-3 rounded-md border border-border bg-background/40 p-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs">
            <Calculator size={14} weight="bold" className="text-muted" />
            <span className="font-medium text-foreground">Melt:</span>
            {meltInfo.meltValue == null ? (
              <span className="text-muted">
                {meltInfo.perGram == null
                  ? meltInfo.purity == null
                    ? 'add metal + karat'
                    : 'no spot price'
                  : 'add weight'}
              </span>
            ) : (
              <span className="font-mono text-foreground">
                {fmt(meltInfo.meltValue)}
              </span>
            )}
            {isOverridden ? (
              <span className="rounded-md bg-warning/10 px-1.5 py-0.5 font-mono text-[10px] text-warning">
                ×{meltInfo.multiplier.toFixed(4)}
              </span>
            ) : null}
            {meltInfo.purity ? (
              <span className="text-[10px] text-muted">
                ({meltInfo.purity})
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <label className="block text-xs">
              <span className="block text-[10px] uppercase tracking-wide text-muted">
                Payout *
              </span>
              <input
                name={`item_${idx}_payout`}
                type="number"
                step="0.01"
                min="0"
                value={row.payout}
                onChange={(e) =>
                  onChange({ payout: e.target.value, payoutAuto: false })
                }
                onFocus={() => onChange({ payoutAuto: false })}
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
        className={`block w-full rounded-md border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-blue/10 ${
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
