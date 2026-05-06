'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import {
  Cart,
  type CartLineState,
  type CustomerOption,
} from '@/components/pos/Cart'
import {
  LayawayScheduleDialog,
  type LayawayScheduleSubmit,
} from '@/components/pos/LayawayScheduleDialog'
import type { InventoryPickRow } from '@/components/pos/AddInventoryItemDialog'
import { computeSubtotal, computeTotal } from '@/lib/pos/cart'
import { createSaleAction } from './actions'

export default function NewSaleForm({
  customers,
  inventory,
  initialCustomerId,
}: {
  customers: CustomerOption[]
  inventory: InventoryPickRow[]
  initialCustomerId: string | null
}) {
  const { t } = useI18n()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string> | null>(
    null,
  )
  const [layawayDraft, setLayawayDraft] = useState<{
    customerId: string | null
    lines: CartLineState[]
    taxRate: string
    discount: string
    notes: string
  } | null>(null)

  function buildFormData(
    saleKind: 'retail' | 'layaway',
    customerId: string | null,
    lines: CartLineState[],
    taxRate: string,
    discount: string,
    notes: string,
    extra?: LayawayScheduleSubmit,
  ): FormData {
    const fd = new FormData()
    fd.set('sale_kind', saleKind)
    if (customerId) fd.set('customer_id', customerId)
    fd.set('tax_rate', taxRate || '0')
    fd.set('discount_amount', discount || '0')
    if (notes) fd.set('notes', notes)
    fd.set('items_count', String(lines.length))
    lines.forEach((l, i) => {
      if (l.inventory_item_id) {
        fd.set(`item_${i}_inventory_item_id`, l.inventory_item_id)
      }
      fd.set(`item_${i}_description`, l.description)
      fd.set(`item_${i}_quantity`, l.quantity || '1')
      fd.set(`item_${i}_unit_price`, l.unit_price || '0')
      fd.set(`item_${i}_line_discount`, l.line_discount || '0')
    })
    if (extra) {
      fd.set('schedule_kind', extra.schedule_kind)
      fd.set('down_payment', extra.down_payment || '0')
      fd.set('down_payment_method', extra.down_payment_method)
      fd.set('first_payment_due', extra.first_payment_due)
      fd.set('final_due_date', extra.final_due_date)
      fd.set('cancellation_fee_pct', extra.cancellation_fee_pct || '0')
    }
    return fd
  }

  function onSubmitSale(
    customerId: string | null,
    lines: CartLineState[],
    taxRate: string,
    discount: string,
    notes: string,
  ) {
    setError(null)
    setFieldErrors(null)
    if (lines.length === 0) {
      setError(t.pos.errors.cartEmpty)
      return
    }
    const fd = buildFormData(
      'retail',
      customerId,
      lines,
      taxRate,
      discount,
      notes,
    )
    startTransition(async () => {
      const res = await createSaleAction(fd)
      if (res.error) {
        setError(translateError(res.error, t))
        if (res.fieldErrors && Object.keys(res.fieldErrors).length > 0) {
          setFieldErrors(res.fieldErrors)
        }
        return
      }
      if (res.fieldErrors && Object.keys(res.fieldErrors).length > 0) {
        setFieldErrors(res.fieldErrors)
        return
      }
      if (res.redirectTo) router.push(res.redirectTo)
    })
  }

  function onSaveAsLayaway(
    customerId: string | null,
    lines: CartLineState[],
    taxRate: string,
    discount: string,
    notes: string,
  ) {
    setError(null)
    setFieldErrors(null)
    if (!customerId) {
      setError(t.pos.errors.customerRequiredForLayaway)
      return
    }
    if (lines.length === 0) {
      setError(t.pos.errors.cartEmpty)
      return
    }
    setLayawayDraft({ customerId, lines, taxRate, discount, notes })
  }

  async function submitLayaway(
    extra: LayawayScheduleSubmit,
  ): Promise<{ error?: string; ok?: boolean }> {
    if (!layawayDraft) return { error: 'no_draft' }
    const fd = buildFormData(
      'layaway',
      layawayDraft.customerId,
      layawayDraft.lines,
      layawayDraft.taxRate,
      layawayDraft.discount,
      layawayDraft.notes,
      extra,
    )
    const res = await createSaleAction(fd)
    if (res.error) {
      if (res.fieldErrors && Object.keys(res.fieldErrors).length > 0) {
        setFieldErrors(res.fieldErrors)
      }
      return { error: translateError(res.error, t) }
    }
    if (res.fieldErrors && Object.keys(res.fieldErrors).length > 0) {
      setFieldErrors(res.fieldErrors)
      return { error: t.common.fixErrorsBelow }
    }
    if (res.redirectTo) router.push(res.redirectTo)
    return { ok: true }
  }

  const layawayTotal = layawayDraft
    ? computeTotal({
        subtotal: computeSubtotal(
          layawayDraft.lines.map((l) => ({
            quantity: l.quantity,
            unit_price: l.unit_price,
            line_discount: l.line_discount,
          })),
        ),
        discount: parseFloat(layawayDraft.discount || '0') || 0,
        tax_rate: parseFloat(layawayDraft.taxRate || '0') || 0,
      }).total
    : 0

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex items-center justify-between">
        <Link
          href="/pos"
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft size={14} weight="bold" />
          {t.pos.backToList}
        </Link>
        <h1 className="text-lg font-semibold text-foreground">
          {t.pos.sale.new}
        </h1>
      </div>

      {!error && fieldErrors && Object.keys(fieldErrors).length > 0 ? (
        <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {t.common.fixErrorsBelow}
        </div>
      ) : null}

      <Cart
        customers={customers}
        inventory={inventory}
        initialCustomerId={initialCustomerId}
        onSubmitSale={onSubmitSale}
        onSaveAsLayaway={onSaveAsLayaway}
        busy={pending}
        error={error}
      />

      {layawayDraft ? (
        <LayawayScheduleDialog
          total={layawayTotal}
          onClose={() => setLayawayDraft(null)}
          onSubmit={submitLayaway}
        />
      ) : null}
    </div>
  )
}

function translateError(
  code: string,
  t: ReturnType<typeof useI18n>['t'],
): string {
  const errors = t.pos.errors as Record<string, string>
  return errors[code] ?? errors.generic
}
