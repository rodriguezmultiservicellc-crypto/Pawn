'use client'

import { useMemo, useState, useTransition } from 'react'
import { ArrowsClockwise } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { r4 } from '@/lib/pos/cart'
import type { PaymentMethod } from '@/types/database-aliases'

export type ReturnPickerSaleItem = {
  id: string
  description: string
  quantity: number
  unit_price: number
  returned_qty: number
  has_inventory: boolean
}

export type ReturnLineState = {
  sale_item_id: string
  quantity: string
  restock: boolean
}

export function ReturnPicker({
  saleId,
  saleItems,
  onSubmit,
}: {
  saleId: string
  saleItems: ReturnPickerSaleItem[]
  onSubmit: (
    formData: FormData,
  ) => Promise<{ error?: string; ok?: boolean }>
}) {
  const { t } = useI18n()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [reason, setReason] = useState<string>('')
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>('cash')
  const [lines, setLines] = useState<Record<string, ReturnLineState>>(() => {
    const init: Record<string, ReturnLineState> = {}
    for (const it of saleItems) {
      init[it.id] = {
        sale_item_id: it.id,
        quantity: '0',
        restock: it.has_inventory,
      }
    }
    return init
  })

  const totals = useMemo(() => {
    let subtotal = 0
    for (const it of saleItems) {
      const ln = lines[it.id]
      const q = parseFloat(ln?.quantity || '0')
      if (!isFinite(q) || q <= 0) continue
      const remaining = r4(it.quantity - it.returned_qty)
      const eff = Math.min(q, remaining)
      subtotal = r4(subtotal + r4(eff * it.unit_price))
    }
    return { subtotal, total: subtotal }
  }, [saleItems, lines])

  const remainingAny = saleItems.some(
    (it) => r4(it.quantity - it.returned_qty) > 0,
  )

  function update(saleItemId: string, patch: Partial<ReturnLineState>) {
    setLines((cur) => ({
      ...cur,
      [saleItemId]: { ...cur[saleItemId], ...patch },
    }))
  }

  function submit() {
    setError(null)
    const selectedLines: ReturnLineState[] = []
    for (const it of saleItems) {
      const ln = lines[it.id]
      const q = parseFloat(ln?.quantity || '0')
      const remaining = r4(it.quantity - it.returned_qty)
      if (!isFinite(q) || q <= 0) continue
      if (q > remaining + 0.0001) {
        setError(t.pos.return.cantExceed)
        return
      }
      selectedLines.push({
        sale_item_id: it.id,
        quantity: ln.quantity,
        restock: ln.restock,
      })
    }
    if (selectedLines.length === 0) {
      setError(t.pos.errors.noEligibleItems)
      return
    }
    if (reason.trim().length < 10) {
      setError(t.pos.return.reasonHelp)
      return
    }
    const fd = new FormData()
    fd.set('sale_id', saleId)
    fd.set('reason', reason)
    fd.set('refund_method', refundMethod)
    fd.set('items_count', String(selectedLines.length))
    selectedLines.forEach((ln, i) => {
      fd.set(`item_${i}_sale_item_id`, ln.sale_item_id)
      fd.set(`item_${i}_quantity`, ln.quantity)
      fd.set(`item_${i}_restock`, ln.restock ? 'on' : '')
    })
    startTransition(async () => {
      const res = await onSubmit(fd)
      if (res.error) setError(res.error)
    })
  }

  if (!remainingAny) {
    return (
      <div className="rounded-md border border-hairline bg-cloud/40 p-6 text-center text-sm text-ash">
        {t.pos.return.noEligibleItems}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {error ? (
        <div className="rounded-md border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">
          {error}
        </div>
      ) : null}

      <fieldset className="rounded-lg border border-hairline bg-canvas p-4">
        <legend className="px-1 text-sm font-semibold text-ink">
          {t.pos.return.selectItems}
        </legend>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-ash">
                <th className="px-2 py-2">{t.pos.cart.itemDescription}</th>
                <th className="px-2 py-2 text-right">{t.pos.cart.qty}</th>
                <th className="px-2 py-2 text-right">{t.pos.return.quantity}</th>
                <th className="px-2 py-2 text-right">{t.pos.cart.unitPrice}</th>
                <th className="px-2 py-2 text-right">{t.pos.cart.lineTotal}</th>
                <th className="px-2 py-2 text-center">
                  {t.pos.return.restock}
                </th>
              </tr>
            </thead>
            <tbody>
              {saleItems.map((it) => {
                const remaining = r4(it.quantity - it.returned_qty)
                const ln = lines[it.id]
                const q = parseFloat(ln?.quantity || '0') || 0
                const eff = Math.min(q, remaining)
                const lineTotal = r4(eff * it.unit_price)
                return (
                  <tr key={it.id} className="border-b border-hairline/60">
                    <td className="px-2 py-2">
                      <div className="font-medium text-ink">
                        {it.description}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-ink">
                      {it.quantity}
                      <span className="ml-1 text-xs text-ash">
                        (−{it.returned_qty})
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right">
                      <input
                        type="number"
                        step="0.001"
                        min={0}
                        max={remaining}
                        value={ln?.quantity ?? '0'}
                        onChange={(e) =>
                          update(it.id, { quantity: e.target.value })
                        }
                        disabled={remaining <= 0}
                        className="block w-20 rounded-md border border-hairline bg-canvas px-2 py-1 text-right text-sm font-mono text-ink focus:border-ink focus:outline-none disabled:opacity-50"
                      />
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-ink">
                      {fmtMoney(it.unit_price)}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-ink">
                      {fmtMoney(lineTotal)}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={ln?.restock ?? true}
                        onChange={(e) =>
                          update(it.id, { restock: e.target.checked })
                        }
                        disabled={!it.has_inventory}
                        className="h-4 w-4 rounded border-hairline"
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </fieldset>

      <fieldset className="rounded-lg border border-hairline bg-canvas p-4">
        <legend className="px-1 text-sm font-semibold text-ink">
          {t.pos.return.refundSummary}
        </legend>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-sm font-medium text-ink">
              {t.pos.return.refundMethod}
            </span>
            <select
              value={refundMethod}
              onChange={(e) =>
                setRefundMethod(e.target.value as PaymentMethod)
              }
              className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
            >
              <option value="cash">{t.pos.payment.methodCash}</option>
              <option value="card">{t.pos.payment.methodCard}</option>
              <option value="check">{t.pos.payment.methodCheck}</option>
              <option value="other">{t.pos.payment.methodOther}</option>
            </select>
          </label>
          <div className="rounded-md border border-hairline bg-cloud/40 p-3 text-sm">
            <div className="text-xs text-ash">
              {t.pos.return.refundTotal}
            </div>
            <div className="font-mono text-base font-semibold text-ink">
              {fmtMoney(totals.total)}
            </div>
          </div>
        </div>
        <label className="mt-3 block space-y-1">
          <span className="text-sm font-medium text-ink">
            {t.pos.return.reason}
          </span>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
          />
          <span className="block text-xs text-ash">
            {t.pos.return.reasonHelp}
          </span>
        </label>
      </fieldset>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          disabled={pending || totals.total <= 0}
          onClick={submit}
          className="inline-flex items-center gap-1 rounded-md bg-rausch px-4 py-2 text-sm font-medium text-canvas hover:bg-rausch-deep disabled:opacity-50"
        >
          <ArrowsClockwise size={14} weight="bold" />
          {pending ? t.pos.return.submitting : t.pos.return.submit}
        </button>
      </div>
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
