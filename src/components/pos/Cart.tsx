'use client'

import { useMemo, useState } from 'react'
import {
  CashRegister,
  Plus,
  ShoppingBag,
  Trash,
  User,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { computeLineTotal, computeSubtotal, computeTotal } from '@/lib/pos/cart'
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

export type CustomerOption = {
  id: string
  first_name: string
  last_name: string
  phone: string | null
}

export function Cart({
  customers,
  inventory,
  initialCustomerId,
  onSubmitSale,
  onSaveAsLayaway,
  busy,
  error,
  layawayDisabled,
}: {
  customers: CustomerOption[]
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
  const [lines, setLines] = useState<CartLineState[]>([])
  const [customerId, setCustomerId] = useState<string | null>(
    initialCustomerId ?? null,
  )
  const [taxRate, setTaxRate] = useState<string>('0')
  const [discount, setDiscount] = useState<string>('0')
  const [notes, setNotes] = useState<string>('')
  const [showInventoryPicker, setShowInventoryPicker] = useState(false)

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
  const totals = useMemo(
    () =>
      computeTotal({
        subtotal,
        discount: parseFloat(discount || '0') || 0,
        tax_rate: parseFloat(taxRate || '0') || 0,
      }),
    [subtotal, discount, taxRate],
  )

  function addInventoryLine(item: InventoryPickRow) {
    setLines((cur) => [
      ...cur,
      {
        inventory_item_id: item.id,
        description: item.description,
        quantity: '1',
        unit_price: (item.list_price ?? 0).toFixed(2),
        line_discount: '0',
        sku: item.sku,
      },
    ])
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
    setLines((cur) =>
      cur.map((l, i) => (i === idx ? { ...l, ...patch } : l)),
    )
  }

  function removeLine(idx: number) {
    setLines((cur) => cur.filter((_, i) => i !== idx))
  }

  const canSubmit = !busy && lines.length > 0

  return (
    <div className="space-y-5">
      {error ? (
        <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}

      {/* Customer picker */}
      <fieldset className="rounded-xl border border-border bg-card p-4">
        <legend className="flex items-center gap-2 px-1 text-sm font-semibold text-foreground">
          <User size={14} weight="bold" />
          {t.pos.sale.customer}
        </legend>
        <select
          value={customerId ?? ''}
          onChange={(e) => setCustomerId(e.target.value || null)}
          className="mt-2 block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
        >
          <option value="">{t.pos.sale.anonymous}</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.last_name}, {c.first_name}
              {c.phone ? ` — ${c.phone}` : ''}
            </option>
          ))}
        </select>
      </fieldset>

      {/* Cart lines */}
      <fieldset className="rounded-xl border border-border bg-card p-4">
        <legend className="flex items-center gap-2 px-1 text-sm font-semibold text-foreground">
          <ShoppingBag size={14} weight="bold" />
          {t.pos.sale.cart}
        </legend>

        {lines.length === 0 ? (
          <div className="mt-3 rounded-md border border-dashed border-border bg-background/40 p-6 text-center text-sm text-muted">
            {t.pos.cart.empty}
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-2 py-2">{t.pos.cart.itemDescription}</th>
                  <th className="px-2 py-2">{t.pos.cart.qty}</th>
                  <th className="px-2 py-2">{t.pos.cart.unitPrice}</th>
                  <th className="px-2 py-2">{t.pos.cart.lineDiscount}</th>
                  <th className="px-2 py-2 text-right">
                    {t.pos.cart.lineTotal}
                  </th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const lineTotal = computeLineTotal({
                    quantity: l.quantity,
                    unit_price: l.unit_price,
                    line_discount: l.line_discount,
                  })
                  return (
                    <tr key={i} className="border-b border-border/60">
                      <td className="px-2 py-2">
                        <input
                          type="text"
                          value={l.description}
                          onChange={(e) =>
                            updateLine(i, { description: e.target.value })
                          }
                          placeholder={t.pos.cart.itemDescription}
                          className="block w-full rounded-md border border-border bg-card px-2 py-1 text-sm text-foreground focus:border-blue focus:outline-none"
                        />
                        {l.sku ? (
                          <div className="mt-1 font-mono text-[10px] text-muted">
                            {l.sku}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="number"
                          step="0.001"
                          min={0}
                          value={l.quantity}
                          onChange={(e) =>
                            updateLine(i, { quantity: e.target.value })
                          }
                          className="block w-20 rounded-md border border-border bg-card px-2 py-1 text-right text-sm font-mono text-foreground focus:border-blue focus:outline-none"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="number"
                          step="0.01"
                          min={0}
                          value={l.unit_price}
                          onChange={(e) =>
                            updateLine(i, { unit_price: e.target.value })
                          }
                          className="block w-24 rounded-md border border-border bg-card px-2 py-1 text-right text-sm font-mono text-foreground focus:border-blue focus:outline-none"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="number"
                          step="0.01"
                          min={0}
                          value={l.line_discount}
                          onChange={(e) =>
                            updateLine(i, { line_discount: e.target.value })
                          }
                          className="block w-24 rounded-md border border-border bg-card px-2 py-1 text-right text-sm font-mono text-foreground focus:border-blue focus:outline-none"
                        />
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-foreground">
                        {fmtMoney(lineTotal)}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => removeLine(i)}
                          className="rounded-md p-1 text-muted hover:bg-danger/10 hover:text-danger"
                          aria-label={t.pos.sale.removeItem}
                        >
                          <Trash size={14} weight="bold" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowInventoryPicker(true)}
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted transition-all hover:bg-background hover:text-foreground"
          >
            <Plus size={14} weight="bold" />
            {t.pos.sale.addItem}
          </button>
          <button
            type="button"
            onClick={addCustomLine}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground hover:bg-background hover:text-foreground"
          >
            <Plus size={14} weight="bold" />
            {t.pos.sale.addCustomLine}
          </button>
        </div>
      </fieldset>

      {/* Totals */}
      <fieldset className="rounded-xl border border-border bg-card p-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-sm font-medium text-foreground">
              {t.pos.sale.taxRate}
            </span>
            <input
              type="number"
              step="0.0001"
              min={0}
              max={1}
              value={taxRate}
              onChange={(e) => setTaxRate(e.target.value)}
              className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
            />
            <span className="block text-xs text-muted">
              {t.pos.sale.taxRateHelp}
            </span>
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-foreground">
              {t.pos.sale.discount}
            </span>
            <input
              type="number"
              step="0.01"
              min={0}
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
            />
          </label>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-3 rounded-md border border-border bg-background/40 p-3 text-sm">
          <div>
            <div className="text-xs text-muted">{t.pos.sale.subtotal}</div>
            <div className="font-mono text-foreground">{fmtMoney(totals.subtotal)}</div>
          </div>
          <div>
            <div className="text-xs text-muted">{t.pos.sale.tax}</div>
            <div className="font-mono text-foreground">{fmtMoney(totals.tax)}</div>
          </div>
          <div>
            <div className="text-xs text-muted">{t.pos.sale.total}</div>
            <div className="font-mono text-base font-semibold text-foreground">
              {fmtMoney(totals.total)}
            </div>
          </div>
        </div>

        <label className="mt-3 block space-y-1">
          <span className="text-sm font-medium text-foreground">
            {t.pos.sale.noteLabel}
          </span>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
          />
        </label>
      </fieldset>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          disabled={!canSubmit || layawayDisabled}
          onClick={() =>
            onSaveAsLayaway(customerId, lines, taxRate, discount, notes)
          }
          className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-background hover:text-foreground disabled:opacity-50"
        >
          {t.pos.sale.saveAsLayaway}
        </button>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() =>
            onSubmitSale(customerId, lines, taxRate, discount, notes)
          }
          className="inline-flex items-center gap-1 rounded-md bg-gold px-4 py-2 text-sm font-medium text-navy hover:bg-gold-2 disabled:opacity-50"
        >
          <CashRegister size={14} weight="bold" />
          {t.pos.sale.completeSale}
        </button>
      </div>

      {showInventoryPicker ? (
        <AddInventoryItemDialog
          items={inventory}
          onClose={() => setShowInventoryPicker(false)}
          onPick={addInventoryLine}
        />
      ) : null}
    </div>
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
