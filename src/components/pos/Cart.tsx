'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { MagnifyingGlass, Minus, Plus, Trash } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { computeLineTotal, computeSubtotal, computeTotal, r4 } from '@/lib/pos/cart'
import { addQuickSale, matchKey, nextUnit, unitsLeft, unlinkedLine, type QuickSaleButton, type QuickUnit } from '@/lib/pos/quick-sale'
import { Footer, Modal } from './Modal'
import CustomerPicker from '@/components/customers/CustomerPicker'
import {
  AddInventoryItemDialog,
  type InventoryPickRow,
} from './AddInventoryItemDialog'
import { parseScan } from '@/lib/labels/scan'
import { resolveScanAction } from '@/app/(staff)/scan-actions'

export type CartLineState = {
  inventory_item_id: string | null
  description: string
  quantity: string
  unit_price: string
  line_discount: string
  sku: string | null
  /** Set when a quick sale button made the line (UI only, never submitted). */
  quick_sale_id?: string | null
}

type Tender = 'cash' | 'card' | 'split'
type DiscMode = 'amt' | 'pct'

// "Ledger" layout, drawn with the locked design tokens. Every control is at
// least 44px tall and shows a 3px focus outline.
const FOCUS =
  'focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-blue'
const LABEL = 'text-xs font-semibold uppercase tracking-[0.08em] text-muted'
const OUTLINE_BTN = `inline-flex h-11 items-center gap-1.5 rounded-md border border-border bg-card px-4 text-sm font-semibold transition-colors hover:bg-background disabled:cursor-not-allowed disabled:opacity-45 ${FOCUS}`
const SMALL_INPUT = `h-11 rounded-md border border-border bg-card px-2.5 text-right font-mono text-sm text-foreground outline-none focus:border-blue ${FOCUS}`

export function Cart({
  inventory,
  initialCustomerId,
  onSubmitSale,
  onSaveAsLayaway,
  busy,
  error,
  layawayDisabled,
  quickSales = [],
  canEditQuickSales = false,
  canAddOutOfStock = false,
}: {
  inventory: InventoryPickRow[]
  initialCustomerId?: string | null
  onSubmitSale: (
    customerId: string | null,
    lines: CartLineState[],
    taxRate: string,
    discount: string,
    notes: string,
    tender: 'cash' | 'card',
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
  quickSales?: QuickSaleButton[]
  canEditQuickSales?: boolean
  /** OUT_OF_STOCK_ADD_ROLES: may add an item with nothing left in stock. */
  canAddOutOfStock?: boolean
}) {
  const { t } = useI18n()
  const ts = t.pos.sale

  const [lines, setLines] = useState<CartLineState[]>([])
  const [customerId, setCustomerId] = useState<string | null>(
    initialCustomerId ?? null,
  )
  // Tax kept as a percentage in the UI; converted to a fraction on
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
  // "Already in the cart — add another one?" popup.
  //   onYes       another unit of the same product is in stock
  //   onOverride  nothing left in stock, but this user may add it anyway
  //               (a line not linked to inventory — OUT_OF_STOCK_ADD_ROLES)
  //   neither     nothing to add: OK only
  // inCart false = a product button tapped with zero stock (not a duplicate).
  const [dupAsk, setDupAsk] = useState<{
    name: string
    inCart: boolean
    onYes: (() => void) | null
    onOverride: (() => void) | null
  } | null>(null)

  const scanRef = useRef<HTMLInputElement>(null)

  // Refocus the scan input after every successful add (barcode-gun throughput).
  const focusScan = () => {
    // rAF so the DOM has settled after the state update re-render.
    // Never pull focus out of an open dialog (the "add another?" popup).
    requestAnimationFrame(() => {
      if (!document.querySelector('[role=dialog]')) scanRef.current?.focus()
    })
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

  // ── Cart mutations ────────────────────────────────────────────────────
  function addInventoryLine(item: InventoryPickRow) {
    // Inventory rows are unique units (pawn forfeits / buys): the same unit
    // can never be qty 2. Ask instead, and offer the next unit of the same
    // product (same description + category) when one is in stock.
    if (lines.some((l) => l.inventory_item_id === item.id)) {
      const other = nextUnit(
        inventory.filter(
          (i) => i.category === item.category && matchKey(i.description) === matchKey(item.description),
        ),
        lines,
      )
      setDupAsk({
        name: item.description,
        inCart: true,
        onYes: other ? () => appendUnit(other) : null,
        onOverride: !other && canAddOutOfStock ? () => appendUnlinked(item.description, item.list_price) : null,
      })
      return
    }
    appendUnit(item)
  }

  /** Out of stock, added anyway: a custom line, never linked to a unit. */
  function appendUnlinked(name: string, price: number | null) {
    setLines((cur) => [...cur, unlinkedLine(name, price)])
    setScanMsg(null)
    focusScan()
  }

  function appendUnit(item: InventoryPickRow | QuickUnit) {
    setLines((cur) => {
      if (cur.some((l) => l.inventory_item_id === item.id)) return cur
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
    setScanMsg(null)
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

  function addQuickSaleLine(b: QuickSaleButton) {
    setScanMsg(null)
    if (b.kind === 'plain') {
      const add = () => {
        setLines((cur) => addQuickSale(cur, b))
        focusScan()
      }
      if (lines.some((l) => l.quick_sale_id === b.id))
        setDupAsk({ name: b.name, inCart: true, onYes: add, onOverride: null })
      else add()
      return
    }
    // Product button: the oldest unit not in the cart yet.
    const unit = nextUnit(b.units, lines)
    const already =
      b.units.some((u) => lines.some((l) => l.inventory_item_id === u.id)) ||
      lines.some((l) => l.inventory_item_id == null && l.description === b.name)
    if (unit && !already) {
      appendUnit(unit)
      return
    }
    // Price for an added-anyway line: the last unit's own price, else the
    // reference price saved with the button.
    const refPrice = b.units.at(-1)?.list_price ?? b.price
    setDupAsk({
      name: b.name,
      inCart: already,
      onYes: unit ? () => appendUnit(unit) : null,
      onOverride: !unit && canAddOutOfStock ? () => appendUnlinked(b.name, refPrice) : null,
    })
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
  async function resolveScan() {
    const q = scanQ.trim()
    if (!q) return
    const ql = q.toLowerCase()

    // 1. Exact SKU match — the typed text, or what a tag's barcode means
    //    (a small tag carries only the number: 000123 → INV-000123).
    const parsed = parseScan(q)
    const parsedSku = parsed.kind === 'inventory' ? parsed.sku.toLowerCase() : null
    const exact = inventory.find((i) => {
      const s = i.sku.toLowerCase()
      return s === ql || s === parsedSku
    })
    if (exact) {
      addInventoryLine(exact)
      setScanQ('')
      return
    }

    // 1b. Not in the loaded list (older stock, or not sellable): ask the
    //     server for the exact code before falling back to text search.
    if (parsed.kind === 'inventory') {
      const hit = await resolveScanAction(q)
      if (hit.kind === 'inventory') {
        if (hit.status === 'available') {
          addInventoryLine({
            id: hit.id,
            sku: hit.sku,
            description: hit.description,
            list_price: hit.list_price,
            category: hit.category,
          })
          setScanQ('')
        } else {
          setScanMsg(
            t.tags.scan.notSellable
              .replace('{code}', hit.sku)
              .replace('{status}', statusLabel(hit.status)),
          )
        }
        return
      }
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

  /** The Add button: resolve what was typed, or browse inventory when empty. */
  function onAddClick() {
    if (scanQ.trim()) {
      void resolveScan()
      return
    }
    setPickerSeed('')
    setShowPicker(true)
  }

  function statusLabel(s: string): string {
    switch (s) {
      case 'held': return t.inventory.statusHeld
      case 'sold': return t.inventory.statusSold
      case 'scrapped': return t.inventory.statusScrapped
      case 'transferred': return t.inventory.transferringBadge
      case 'returned': return t.inventory.statusReturned
      default: return t.inventory.statusAvailable
    }
  }

  const canSubmit = !busy && lines.length > 0
  const taxRateForSubmit = String(taxFraction)
  const discountForSubmit = discountDollars.toFixed(2)
  const showQuickRow = quickSales.length > 0 || canEditQuickSales

  return (
    <div className="flex min-h-[calc(100dvh-11rem)] flex-col gap-4">
      {error ? (
        <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}

      {/* ── Action row ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[260px] flex-1">
          <MagnifyingGlass
            size={20}
            weight="bold"
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted"
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
                void resolveScan()
              }
            }}
            placeholder={ts.scanPlaceholder}
            aria-label={ts.scanPlaceholder}
            className={`h-[52px] w-full rounded-md border-2 border-blue bg-card pl-12 pr-24 text-base font-semibold text-foreground outline-none placeholder:font-medium placeholder:text-muted ${FOCUS}`}
          />
          <button
            type="button"
            onClick={onAddClick}
            className={`absolute right-1.5 top-1/2 h-11 -translate-y-1/2 rounded-md bg-gold px-4 text-sm font-bold text-navy transition-colors hover:bg-gold-2 ${FOCUS}`}
          >
            {ts.add}
          </button>
        </div>
        <button type="button" onClick={addCustomLine} className={`${OUTLINE_BTN} text-foreground`}>
          <Plus size={16} weight="bold" />
          {ts.addCustomLine}
        </button>
        <button type="button" onClick={clearCart} className={`${OUTLINE_BTN} text-danger`}>
          {ts.clear}
        </button>
      </div>
      {scanMsg ? (
        <p className="-mt-2 text-xs font-medium text-danger">{scanMsg}</p>
      ) : null}

      {/* ── Quick sale ─────────────────────────────────────────────────── */}
      {showQuickRow ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className={`${LABEL} mr-1`}>{t.quickSale.label}</span>
          {quickSales.map((b) => {
            // Product buttons show the next unit's price and what is left;
            // with nothing left (in stock or outside the cart) they grey out.
            const left = b.kind === 'product' ? unitsLeft(b.units, lines) : null
            const price = b.kind === 'plain' ? b.price : nextUnit(b.units, lines)?.list_price ?? null
            // Managers and up can still tap it (they get the "add anyway" popup).
            const empty = b.kind === 'product' && b.units.length === 0 && !canAddOutOfStock
            return (
              <button
                key={b.id}
                type="button"
                disabled={empty}
                onClick={() => addQuickSaleLine(b)}
                className={`h-11 rounded-full border border-border bg-background px-4 text-sm font-semibold text-foreground transition-colors hover:border-blue disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-border ${FOCUS}`}
              >
                {b.name}
                {price != null ? (
                  <>
                    {' · '}
                    <span className="font-mono">{fmtMoney(price)}</span>
                  </>
                ) : null}
                {left != null ? (
                  <span className="ml-1.5 text-xs font-medium text-muted">
                    {left > 0 ? t.quickSale.unitsLeft.replace('{count}', String(left)) : t.quickSale.noneLeft}
                  </span>
                ) : null}
              </button>
            )
          })}
          {canEditQuickSales ? (
            <Link
              href="/settings/quick-sale"
              className={`inline-flex h-11 items-center px-2 text-sm font-semibold text-blue hover:text-blue-2 hover:underline ${FOCUS}`}
            >
              {t.quickSale.editButtons}
            </Link>
          ) : null}
        </div>
      ) : null}

      {/* ── Line items ─────────────────────────────────────────────────── */}
      {/* inline-size containment: the wide table scrolls inside this box
          instead of widening the page on a phone. */}
      <div className="min-h-[240px] flex-1 overflow-x-auto rounded-lg border border-border bg-card [contain:inline-size]">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead className="bg-background">
            <tr className="border-b border-border">
              <th className={`${LABEL} w-12 px-4 py-3 text-left`}>{ts.colNo}</th>
              <th className={`${LABEL} px-4 py-3 text-left`}>{t.pos.cart.sku}</th>
              <th className={`${LABEL} px-4 py-3 text-left`}>{ts.colItem}</th>
              <th className={`${LABEL} px-4 py-3 text-right`}>{t.pos.cart.qty}</th>
              <th className={`${LABEL} px-4 py-3 text-right`}>{ts.colUnit}</th>
              <th className={`${LABEL} px-4 py-3 text-right`}>{ts.colAmount}</th>
              <th className="w-16 px-4 py-3">
                <span className="sr-only">{ts.removeItem}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted">
                  {ts.emptyLedger}
                </td>
              </tr>
            ) : (
              lines.map((l, i) => {
                const isInventory = !!l.inventory_item_id
                const lineTotal = computeLineTotal({
                  quantity: l.quantity,
                  unit_price: l.unit_price,
                  line_discount: l.line_discount,
                })
                return (
                  <tr key={i} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-4 font-mono text-muted">{i + 1}</td>
                    <td className="px-4 py-4 font-mono text-foreground">
                      {isInventory ? l.sku : <span className="text-muted">{ts.customLine}</span>}
                    </td>
                    <td className="px-4 py-4">
                      {isInventory ? (
                        <span className="font-semibold text-foreground">{l.description}</span>
                      ) : (
                        <input
                          type="text"
                          value={l.description}
                          onChange={(e) => updateLine(i, { description: e.target.value })}
                          placeholder={t.pos.cart.itemDescription}
                          aria-label={t.pos.cart.itemDescription}
                          className={`h-11 w-full min-w-[180px] rounded-md border border-border bg-card px-3 font-semibold text-foreground outline-none focus:border-blue ${FOCUS}`}
                        />
                      )}
                    </td>
                    <td className="px-4 py-4 text-right">
                      {/* Unique units are locked at 1; custom lines step. */}
                      {isInventory ? (
                        <span className="font-mono font-semibold text-foreground">1</span>
                      ) : (
                        <span className="inline-flex items-center overflow-hidden rounded-md border border-border">
                          <button
                            type="button"
                            onClick={() => stepQty(i, -1)}
                            aria-label={ts.qtyDecrease}
                            className={`grid h-11 w-11 place-items-center text-foreground hover:bg-background ${FOCUS}`}
                          >
                            <Minus size={14} weight="bold" />
                          </button>
                          <span className="w-9 text-center font-mono font-semibold">
                            {parseFloat(l.quantity) || 0}
                          </span>
                          <button
                            type="button"
                            onClick={() => stepQty(i, 1)}
                            aria-label={ts.qtyIncrease}
                            className={`grid h-11 w-11 place-items-center text-foreground hover:bg-background ${FOCUS}`}
                          >
                            <Plus size={14} weight="bold" />
                          </button>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-4 text-right">
                      {isInventory ? (
                        <span className="font-mono text-foreground">
                          {fmtMoney(parseFloat(l.unit_price) || 0)}
                        </span>
                      ) : (
                        <input
                          type="number"
                          step="0.01"
                          min={0}
                          value={l.unit_price}
                          onChange={(e) => updateLine(i, { unit_price: e.target.value })}
                          aria-label={t.pos.cart.unitPrice}
                          className={`${SMALL_INPUT} w-28`}
                        />
                      )}
                    </td>
                    <td className="px-4 py-4 text-right font-mono font-semibold text-foreground">
                      {fmtMoney(lineTotal)}
                    </td>
                    <td className="px-4 py-4 text-right">
                      <button
                        type="button"
                        onClick={() => removeLine(i)}
                        aria-label={ts.removeItem}
                        className={`grid h-11 w-11 place-items-center rounded-md text-muted hover:bg-danger/10 hover:text-danger ${FOCUS}`}
                      >
                        <Trash size={16} weight="bold" />
                      </button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── Checkout bar ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 rounded-lg border border-foreground bg-card md:grid-cols-2 xl:grid-cols-[minmax(240px,1fr)_minmax(340px,1.4fr)_auto_minmax(240px,1fr)]">
        {/* a. Customer */}
        <div className="space-y-2 border-border p-4">
          <div className={LABEL}>{ts.customer}</div>
          <CustomerPicker
            name="customer_id"
            initialCustomerId={initialCustomerId ?? null}
            onChange={(c) => setCustomerId(c?.id ?? null)}
          />
          <button
            type="button"
            onClick={() => setShowNote((s) => !s)}
            className={`inline-flex h-11 items-center text-sm font-semibold text-blue hover:text-blue-2 hover:underline ${FOCUS}`}
          >
            {ts.addNote}
          </button>
          {showNote ? (
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={ts.noteLabel}
              aria-label={ts.noteLabel}
              className={`block w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-blue ${FOCUS}`}
            />
          ) : null}
        </div>

        {/* b. Totals */}
        <div className="space-y-1 border-t border-border p-4 md:border-l md:border-t-0">
          <div className="flex min-h-11 items-center justify-between text-sm">
            <span className="font-semibold text-muted">{ts.subtotal}</span>
            <span className="shrink-0 whitespace-nowrap font-mono font-semibold text-foreground">{fmtMoney(totals.subtotal)}</span>
          </div>
          <div className="flex min-h-11 items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-2 font-semibold text-muted">
              {ts.discount}
              <span className="inline-flex overflow-hidden rounded-md border border-border">
                {(['amt', 'pct'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setDiscMode(m)}
                    aria-pressed={discMode === m}
                    className={`h-11 w-9 text-sm font-bold ${
                      discMode === m ? 'bg-foreground text-white' : 'bg-card text-foreground hover:bg-background'
                    } ${FOCUS}`}
                  >
                    {m === 'amt' ? '$' : '%'}
                  </button>
                ))}
              </span>
              <input
                type="number"
                step="0.01"
                min={0}
                value={discInput}
                onChange={(e) => setDiscInput(e.target.value)}
                inputMode="decimal"
                aria-label={ts.discount}
                className={`${SMALL_INPUT} w-[4.5rem]`}
              />
            </span>
            <span className="shrink-0 whitespace-nowrap font-mono font-semibold text-foreground">−{fmtMoney(totals.discount)}</span>
          </div>
          <div className="flex min-h-11 items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-2 font-semibold text-muted">
              {ts.tax}
              <span className="inline-flex items-center gap-1">
                <input
                  type="number"
                  step="0.001"
                  min={0}
                  max={100}
                  value={taxPercent}
                  onChange={(e) => setTaxPercent(e.target.value)}
                  aria-label={ts.taxRate}
                  className={`${SMALL_INPUT} w-[4.5rem]`}
                />
                %
              </span>
            </span>
            <span className="shrink-0 whitespace-nowrap font-mono font-semibold text-foreground">{fmtMoney(totals.tax)}</span>
          </div>
        </div>

        {/* c. Tender */}
        <div className="space-y-2 border-t border-border p-4 xl:border-l xl:border-t-0">
          <div className={LABEL}>{ts.tender}</div>
          <div role="radiogroup" aria-label={ts.tender} className="inline-flex overflow-hidden rounded-md border border-foreground">
            <TenderButton label={ts.tenderCash} active={tender === 'cash'} onClick={() => setTender('cash')} />
            <TenderButton label={ts.tenderCard} active={tender === 'card'} onClick={() => setTender('card')} />
            <TenderButton label={ts.tenderSplit} active={false} disabled title={ts.splitSoon} onClick={() => {}} />
          </div>
        </div>

        {/* d. Total + actions */}
        <div className="space-y-2 border-t border-border p-4 md:border-l xl:border-t-0">
          <div className={LABEL}>{ts.totalDue}</div>
          <div className="font-mono text-[40px] font-bold leading-none tabular-nums text-foreground">
            {fmtMoney(totals.total)}
          </div>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() =>
              onSubmitSale(customerId, lines, taxRateForSubmit, discountForSubmit, notes, tender === 'card' ? 'card' : 'cash')
            }
            className={`flex h-14 w-full items-center justify-center rounded-md bg-gold text-[17px] font-bold text-navy transition-colors hover:bg-gold-2 disabled:cursor-not-allowed disabled:opacity-45 ${FOCUS}`}
          >
            {ts.charge.replace('{amount}', fmtMoney(totals.total))}
          </button>
          <button
            type="button"
            disabled={!canSubmit || layawayDisabled}
            onClick={() =>
              onSaveAsLayaway(customerId, lines, taxRateForSubmit, discountForSubmit, notes)
            }
            className={`${OUTLINE_BTN} w-full justify-center text-foreground`}
          >
            {ts.saveAsLayaway}
          </button>
        </div>
      </div>

      {dupAsk ? (
        <Modal
          title={dupAsk.inCart ? ts.alreadyInCart : ts.outOfStock}
          onClose={() => {
            setDupAsk(null)
            focusScan()
          }}
        >
          <p className="text-sm text-foreground">
            {(dupAsk.onYes
              ? ts.dupAddAnother
              : dupAsk.inCart
                ? ts.dupNoneLeft
                : ts.outOfStockMsg
            ).replace('{name}', dupAsk.name)}
          </p>
          {dupAsk.onOverride ? <p className="mt-2 text-sm text-muted">{ts.addAnywayHelp}</p> : null}
          <Footer>
            {dupAsk.onOverride ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setDupAsk(null)
                    focusScan()
                  }}
                  className={`${OUTLINE_BTN} text-foreground`}
                >
                  {ts.dupNo}
                </button>
                <button
                  type="button"
                  autoFocus
                  onClick={() => {
                    const add = dupAsk.onOverride
                    setDupAsk(null)
                    add?.()
                  }}
                  className={`h-11 rounded-md bg-gold px-5 text-sm font-bold text-navy transition-colors hover:bg-gold-2 ${FOCUS}`}
                >
                  {ts.addAnyway}
                </button>
              </>
            ) : dupAsk.onYes ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setDupAsk(null)
                    focusScan()
                  }}
                  className={`${OUTLINE_BTN} text-foreground`}
                >
                  {ts.dupNo}
                </button>
                <button
                  type="button"
                  autoFocus
                  onClick={() => {
                    const yes = dupAsk.onYes
                    setDupAsk(null)
                    yes?.()
                    focusScan()
                  }}
                  className={`h-11 rounded-md bg-gold px-5 text-sm font-bold text-navy transition-colors hover:bg-gold-2 ${FOCUS}`}
                >
                  {ts.dupYes}
                </button>
              </>
            ) : (
              <button
                type="button"
                autoFocus
                onClick={() => {
                  setDupAsk(null)
                  focusScan()
                }}
                className={`h-11 rounded-md bg-gold px-5 text-sm font-bold text-navy transition-colors hover:bg-gold-2 ${FOCUS}`}
              >
                {ts.dupOk}
              </button>
            )}
          </Footer>
        </Modal>
      ) : null}

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

function TenderButton({
  label,
  active,
  disabled,
  title,
  onClick,
}: {
  label: string
  active: boolean
  disabled?: boolean
  title?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`h-11 min-w-[72px] border-l border-foreground px-4 text-sm font-bold first:border-l-0 ${
        active ? 'bg-foreground text-white' : 'bg-card text-foreground hover:bg-background'
      } disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS}`}
    >
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
