'use client'

import { useMemo, useRef, useState } from 'react'
import {
  Barcode,
  CheckCircle,
  CreditCard,
  Minus,
  Money,
  Note,
  Plus,
  Trash,
  User,
  UsersThree,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { computeLineTotal, computeSubtotal, computeTotal, r4 } from '@/lib/pos/cart'
import CustomerPicker from '@/components/customers/CustomerPicker'
import {
  AddInventoryItemDialog,
  type InventoryPickRow,
} from './AddInventoryItemDialog'

export type CartLineState = {
  inventory_item_id: string | null
  description: string
  quantity: string
  unit_price: string
  line_discount: string
  sku: string | null
}

type Tender = 'cash' | 'card' | 'split'
type DiscMode = 'amt' | 'pct'

export function Cart({
  inventory,
  initialCustomerId,
  onSubmitSale,
  onSaveAsLayaway,
  busy,
  error,
  layawayDisabled,
}: {
  inventory: InventoryPickRow[]
  initialCustomerId?: string | null
  onSubmitSale: (
    customerId: string | null,
    lines: CartLineState[],
    taxRate: string,
    discount: string,
    notes: string,
  ) => void
  onSaveAsLayaway: (
    customerId: string | null,
    lines: CartLineState[],
    taxRate: string,
    discount: string,
    notes: string,
  ) => void
  busy?: boolean
  error?: string | null
  layawayDisabled?: boolean
}) {
  const { t } = useI18n()
  const ts = t.pos.sale

  const [lines, setLines] = useState<CartLineState[]>([])
  const [customerId, setCustomerId] = useState<string | null>(
    initialCustomerId ?? null,
  )
  // Tax kept as a percentage in the UI (chip); converted to a fraction on
  // submit. No tenant/register default exists yet — defaults to 0.
  const [taxPercent, setTaxPercent] = useState<string>('0')
  const [discMode, setDiscMode] = useState<DiscMode>('amt')
  const [discInput, setDiscInput] = useState<string>('0')
  const [notes, setNotes] = useState<string>('')
  const [showNote, setShowNote] = useState(false)
  const [tender, setTender] = useState<Tender>('cash')
  const [scanQ, setScanQ] = useState<string>('')
  const [scanMsg, setScanMsg] = useState<string | null>(null)
  const [showPicker, setShowPicker] = useState(false)
  const [pickerSeed, setPickerSeed] = useState<string>('')

  const scanRef = useRef<HTMLInputElement>(null)

  // Refocus the scan input after every successful add (barcode-gun throughput).
  const focusScan = () => {
    // rAF so the DOM has settled after the state update re-render.
    requestAnimationFrame(() => scanRef.current?.focus())
  }

  const subtotal = useMemo(
    () =>
      computeSubtotal(
        lines.map((l) => ({
          quantity: l.quantity,
          unit_price: l.unit_price,
          line_discount: l.line_discount,
        })),
      ),
    [lines],
  )

  const taxFraction = (parseFloat(taxPercent) || 0) / 100
  const discInputNum = parseFloat(discInput) || 0
  const discountDollars = Math.min(
    subtotal,
    Math.max(
      0,
      discMode === 'amt' ? r4(discInputNum) : r4((subtotal * discInputNum) / 100),
    ),
  )

  const totals = useMemo(
    () =>
      computeTotal({
        subtotal,
        discount: discountDollars,
        tax_rate: taxFraction,
      }),
    [subtotal, discountDollars, taxFraction],
  )

  const itemCount = lines.reduce(
    (a, l) => a + (parseFloat(l.quantity) || 0),
    0,
  )

  // ── Cart mutations ────────────────────────────────────────────────────
  function addInventoryLine(item: InventoryPickRow) {
    let added = false
    setLines((cur) => {
      // Inventory items are unique units (pawn forfeits / buys): a second add
      // of the same unit is a no-op, never qty 2.
      if (cur.some((l) => l.inventory_item_id === item.id)) return cur
      added = true
      return [
        ...cur,
        {
          inventory_item_id: item.id,
          description: item.description,
          quantity: '1',
          unit_price: (item.list_price ?? 0).toFixed(2),
          line_discount: '0',
          sku: item.sku,
        },
      ]
    })
    setScanMsg(added ? null : ts.alreadyInCart)
    focusScan()
  }

  function addCustomLine() {
    setLines((cur) => [
      ...cur,
      {
        inventory_item_id: null,
        description: '',
        quantity: '1',
        unit_price: '0',
        line_discount: '0',
        sku: null,
      },
    ])
  }

  function updateLine(idx: number, patch: Partial<CartLineState>) {
    setLines((cur) => cur.map((l, i) => (i === idx ? { ...l, ...patch } : l)))
  }

  function removeLine(idx: number) {
    setLines((cur) => cur.filter((_, i) => i !== idx))
  }

  function stepQty(idx: number, delta: number) {
    setLines((cur) => {
      const next = cur
        .map((l, i) => {
          if (i !== idx) return l
          const q = (parseFloat(l.quantity) || 0) + delta
          return { ...l, quantity: String(q) }
        })
        .filter((l) => (parseFloat(l.quantity) || 0) > 0)
      return next
    })
  }

  function clearCart() {
    if (lines.length > 0 && !confirm(ts.clearConfirm)) return
    setLines([])
    setScanMsg(null)
  }

  // ── Scan resolve ──────────────────────────────────────────────────────
  function resolveScan() {
    const q = scanQ.trim()
    if (!q) return
    const ql = q.toLowerCase()

    // 1. Exact SKU match.
    const exact = inventory.find((i) => i.sku.toLowerCase() === ql)
    if (exact) {
      addInventoryLine(exact)
      setScanQ('')
      return
    }
    // 2. Partial name/SKU match.
    const hits = inventory.filter(
      (i) =>
        i.sku.toLowerCase().includes(ql) ||
        i.description.toLowerCase().includes(ql),
    )
    if (hits.length === 1) {
      addInventoryLine(hits[0])
      setScanQ('')
      return
    }
    if (hits.length > 1) {
      // Hand off to the searchable picker, pre-seeded with the query.
      setPickerSeed(q)
      setShowPicker(true)
      setScanQ('')
      return
    }
    // 3. No hit — inline message, cart unchanged.
    setScanMsg(ts.noItemFound.replace('{q}', q))
  }

  const canSubmit = !busy && lines.length > 0
  const taxRateForSubmit = String(taxFraction)
  const discountForSubmit = discountDollars.toFixed(2)

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1fr_380px]">
      {/* ── LEFT: work surface ───────────────────────────────────────── */}
      <section className="flex flex-col gap-3.5">
        {error ? (
          <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
            {error}
          </div>
        ) : null}

        {/* ScanBar */}
        <div className="relative">
          <Barcode
            size={22}
            weight="bold"
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gold"
          />
          <input
            ref={scanRef}
            type="text"
            value={scanQ}
            autoFocus
            onChange={(e) => {
              setScanQ(e.target.value)
              if (scanMsg) setScanMsg(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                resolveScan()
              }
            }}
            placeholder={ts.scanPlaceholder}
            className="h-[60px] w-full rounded-xl border-2 border-border bg-card pl-12 pr-16 text-base font-semibold text-foreground shadow-sm outline-none transition-colors placeholder:font-medium placeholder:text-muted focus:border-gold"
          />
          <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-bold text-muted">
            {ts.enterHint}
          </span>
        </div>
        {scanMsg ? (
          <p className="-mt-1 text-xs font-medium text-danger">{scanMsg}</p>
        ) : null}

        {/* QuickActions */}
        <div className="flex flex-wrap gap-2.5">
          <button
            type="button"
            onClick={() => {
              setPickerSeed('')
              setShowPicker(true)
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm font-bold text-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:border-gold/50 hover:shadow-lg"
          >
            <Plus size={16} weight="bold" className="text-gold" />
            {ts.addItem}
          </button>
          <button
            type="button"
            onClick={addCustomLine}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm font-bold text-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:border-gold/50 hover:shadow-lg"
          >
            <Plus size={16} weight="bold" className="text-gold" />
            {ts.addCustomLine}
          </button>
          <button
            type="button"
            onClick={clearCart}
            className="ml-auto inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm font-bold text-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:border-danger/40 hover:text-danger hover:shadow-lg"
          >
            <Trash size={16} weight="bold" />
            {ts.clear}
          </button>
        </div>

        {/* LineItemList */}
        <div className="flex min-h-[320px] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
            <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-muted">
              {ts.lineItems}
            </h2>
            <span className="text-xs font-bold text-gold tabular-nums">
              {itemCount} {itemCount === 1 ? ts.itemOne : ts.itemMany}
            </span>
          </div>

          {lines.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-6 py-10 text-center">
              <div className="font-bold text-text-secondary">
                {t.pos.cart.empty}
              </div>
            </div>
          ) : (
            <div>
              {lines.map((l, i) => {
                const isInventory = !!l.inventory_item_id
                const lineTotal = computeLineTotal({
                  quantity: l.quantity,
                  unit_price: l.unit_price,
                  line_discount: l.line_discount,
                })
                return (
                  <div
                    key={i}
                    className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 border-b border-border px-4 py-3.5 last:border-b-0"
                  >
                    <div className="min-w-0">
                      {isInventory ? (
                        <div className="truncate font-bold text-foreground">
                          {l.description}
                        </div>
                      ) : (
                        <input
                          type="text"
                          value={l.description}
                          onChange={(e) =>
                            updateLine(i, { description: e.target.value })
                          }
                          placeholder={t.pos.cart.itemDescription}
                          className="block w-full rounded-md border border-border bg-card px-2 py-1 text-sm font-semibold text-foreground focus:border-blue focus:outline-none"
                        />
                      )}
                      <div className="mt-1 flex items-center gap-2 text-xs font-semibold text-muted">
                        <span className="font-mono">
                          {isInventory ? `SKU ${l.sku}` : ts.customLine}
                        </span>
                        {isInventory ? (
                          <span className="tabular-nums">
                            {fmtMoney(parseFloat(l.unit_price) || 0)} {ts.eachSuffix}
                          </span>
                        ) : (
                          <input
                            type="number"
                            step="0.01"
                            min={0}
                            value={l.unit_price}
                            onChange={(e) =>
                              updateLine(i, { unit_price: e.target.value })
                            }
                            className="w-24 rounded-md border border-border bg-card px-2 py-1 text-right font-mono text-xs text-foreground focus:border-blue focus:outline-none"
                          />
                        )}
                      </div>
                    </div>

                    {/* Qty: stepper for custom lines; locked 1 for unique units */}
                    {isInventory ? (
                      <span className="w-[98px] text-center text-sm font-bold tabular-nums text-foreground">
                        ×1
                      </span>
                    ) : (
                      <div className="flex items-center overflow-hidden rounded-lg border border-border">
                        <button
                          type="button"
                          onClick={() => stepQty(i, -1)}
                          aria-label={ts.qtyDecrease}
                          className="grid h-[30px] w-[30px] place-items-center bg-background text-navy hover:bg-border/60"
                        >
                          <Minus size={14} weight="bold" />
                        </button>
                        <span className="w-9 text-center text-sm font-bold tabular-nums">
                          {parseFloat(l.quantity) || 0}
                        </span>
                        <button
                          type="button"
                          onClick={() => stepQty(i, 1)}
                          aria-label={ts.qtyIncrease}
                          className="grid h-[30px] w-[30px] place-items-center bg-background text-navy hover:bg-border/60"
                        >
                          <Plus size={14} weight="bold" />
                        </button>
                      </div>
                    )}

                    <div className="min-w-[74px] text-right font-bold tabular-nums text-foreground">
                      {fmtMoney(lineTotal)}
                    </div>

                    <button
                      type="button"
                      onClick={() => removeLine(i)}
                      aria-label={ts.removeItem}
                      className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-danger/10 hover:text-danger"
                    >
                      <Trash size={14} weight="bold" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>

      {/* ── RIGHT: checkout rail ─────────────────────────────────────── */}
      <aside className="rounded-2xl bg-navy p-[18px] text-white shadow-lg lg:sticky lg:top-4">
        {/* Customer */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-gold/15 text-gold">
              <User size={18} weight="bold" />
            </span>
            <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-white/55">
              {ts.customer}
            </span>
          </div>
          <div className="rounded-lg bg-white p-2">
            <CustomerPicker
              name="customer_id"
              initialCustomerId={initialCustomerId ?? null}
              onChange={(c) => setCustomerId(c?.id ?? null)}
            />
          </div>
        </div>

        {/* Order summary */}
        <div className="mt-3 px-0.5">
          <SummaryRow label={ts.subtotal} value={fmtMoney(totals.subtotal)} />

          <div className="flex items-center justify-between py-2 text-sm">
            <span className="flex items-center gap-2 font-semibold text-white/60">
              {ts.discount}
              <span className="inline-flex rounded-lg bg-white/10 p-0.5">
                <button
                  type="button"
                  onClick={() => setDiscMode('amt')}
                  className={`rounded-md px-2.5 py-1 text-xs font-bold ${
                    discMode === 'amt'
                      ? 'bg-gold text-navy'
                      : 'text-white/60'
                  }`}
                >
                  $
                </button>
                <button
                  type="button"
                  onClick={() => setDiscMode('pct')}
                  className={`rounded-md px-2.5 py-1 text-xs font-bold ${
                    discMode === 'pct'
                      ? 'bg-gold text-navy'
                      : 'text-white/60'
                  }`}
                >
                  %
                </button>
              </span>
              <input
                type="number"
                step="0.01"
                min={0}
                value={discInput}
                onChange={(e) => setDiscInput(e.target.value)}
                inputMode="decimal"
                className="h-8 w-20 rounded-lg border border-white/15 bg-white/[0.07] px-2.5 text-right text-sm font-bold tabular-nums text-white outline-none focus:border-gold"
              />
            </span>
            <span className="font-bold tabular-nums text-gold-2">
              −{fmtMoney(totals.discount)}
            </span>
          </div>

          <div className="flex items-center justify-between py-2 text-sm">
            <span className="flex items-center gap-2 font-semibold text-white/60">
              {ts.tax}
              <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/10 px-2 py-1 text-xs font-bold">
                <input
                  type="number"
                  step="0.001"
                  min={0}
                  max={100}
                  value={taxPercent}
                  onChange={(e) => setTaxPercent(e.target.value)}
                  aria-label={ts.taxRate}
                  className="w-12 bg-transparent text-right tabular-nums outline-none"
                />
                %
              </span>
            </span>
            <span className="font-bold tabular-nums">
              {fmtMoney(totals.tax)}
            </span>
          </div>

          <div className="my-1.5 h-px bg-white/10" />

          <div className="flex items-end justify-between py-1">
            <span className="text-[13px] font-bold uppercase tracking-[0.04em] text-white/60">
              {ts.total}
            </span>
            <span className="text-[34px] font-extrabold leading-none tabular-nums">
              {fmtMoney(totals.total)}
            </span>
          </div>
        </div>

        {/* Tender */}
        <div className="mb-2 mt-3.5 text-[11px] font-bold uppercase tracking-[0.06em] text-white/50">
          {ts.tender}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <TenderTile
            label={ts.tenderCash}
            active={tender === 'cash'}
            onClick={() => setTender('cash')}
            icon={<Money size={20} weight="bold" />}
          />
          <TenderTile
            label={ts.tenderCard}
            active={tender === 'card'}
            onClick={() => setTender('card')}
            icon={<CreditCard size={20} weight="bold" />}
          />
          <TenderTile
            label={ts.tenderSplit}
            active={false}
            disabled
            title={ts.splitSoon}
            onClick={() => {}}
            icon={<UsersThree size={20} weight="bold" />}
          />
        </div>

        {/* Charge */}
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() =>
            onSubmitSale(
              customerId,
              lines,
              taxRateForSubmit,
              discountForSubmit,
              notes,
            )
          }
          className="mt-3.5 flex h-[58px] w-full items-center justify-center gap-2.5 rounded-xl bg-gradient-to-b from-gold-2 to-gold text-[17px] font-extrabold text-[#3a2600] shadow-lg transition-all hover:-translate-y-0.5 hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none disabled:hover:translate-y-0"
        >
          <CheckCircle size={19} weight="bold" />
          {ts.charge.replace('{amount}', fmtMoney(totals.total))}
        </button>

        {/* Secondary actions */}
        <div className="mt-2.5">
          <button
            type="button"
            disabled={!canSubmit || layawayDisabled}
            onClick={() =>
              onSaveAsLayaway(
                customerId,
                lines,
                taxRateForSubmit,
                discountForSubmit,
                notes,
              )
            }
            className="h-[42px] w-full rounded-lg border border-white/15 bg-white/[0.07] text-sm font-bold text-white hover:bg-white/[0.12] disabled:opacity-45"
          >
            {ts.saveAsLayaway}
          </button>
        </div>

        <button
          type="button"
          onClick={() => setShowNote((s) => !s)}
          className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-white/55 hover:text-white"
        >
          <Note size={14} weight="bold" />
          {ts.addNote}
        </button>
        {showNote ? (
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={ts.noteLabel}
            className="mt-2 block w-full rounded-lg border border-white/15 bg-white/[0.07] px-3 py-2 text-sm text-white outline-none placeholder:text-white/40 focus:border-gold"
          />
        ) : null}
      </aside>

      {showPicker ? (
        <AddInventoryItemDialog
          items={inventory}
          initialQuery={pickerSeed}
          onClose={() => {
            setShowPicker(false)
            focusScan()
          }}
          onPick={addInventoryLine}
        />
      ) : null}
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 text-sm">
      <span className="font-semibold text-white/60">{label}</span>
      <span className="font-bold tabular-nums">{value}</span>
    </div>
  )
}

function TenderTile({
  label,
  icon,
  active,
  disabled,
  title,
  onClick,
}: {
  label: string
  icon: React.ReactNode
  active: boolean
  disabled?: boolean
  title?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex flex-col items-center gap-1.5 rounded-xl border-[1.5px] px-1.5 py-2.5 text-[12.5px] font-bold text-white transition-colors ${
        active
          ? 'border-gold bg-gold/15 [&_svg]:text-gold'
          : 'border-white/10 bg-white/5 [&_svg]:text-white/70 hover:border-gold/60'
      } disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {icon}
      {label}
    </button>
  )
}

function fmtMoney(v: number): string {
  if (!isFinite(v)) return '—'
  return v.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  })
}
