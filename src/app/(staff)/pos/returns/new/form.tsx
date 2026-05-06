'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import {
  ReturnPicker,
  type ReturnPickerSaleItem,
} from '@/components/pos/ReturnPicker'
import { createReturnAction } from './actions'
import type { SaleStatus } from '@/types/database-aliases'

export type NewReturnSale = {
  id: string
  sale_number: string
  status: SaleStatus
  total: number
  paid_total: number
  returned_total: number
}

export default function NewReturnForm({
  sale,
  items,
}: {
  sale: NewReturnSale
  items: ReturnPickerSaleItem[]
}) {
  const { t } = useI18n()
  const router = useRouter()

  async function onSubmit(
    fd: FormData,
  ): Promise<{ error?: string; ok?: boolean }> {
    const res = await createReturnAction(fd)
    if (res.error) {
      const errors = t.pos.errors as Record<string, string>
      return { error: errors[res.error] ?? errors.generic }
    }
    if (res.redirectTo) router.push(res.redirectTo)
    return { ok: true }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex items-center justify-between">
        <Link
          href={`/pos/sales/${sale.id}`}
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft size={14} weight="bold" />
          {t.pos.return.backToSale}
        </Link>
        <h1 className="text-lg font-semibold text-foreground">
          {t.pos.return.new}
        </h1>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="text-xs uppercase tracking-wide text-muted">
          {t.pos.return.saleLookup}
        </div>
        <div className="mt-1 font-mono text-base font-semibold text-foreground">
          {sale.sale_number}
        </div>
      </div>

      <ReturnPicker
        saleId={sale.id}
        saleItems={items}
        onSubmit={onSubmit}
      />
    </div>
  )
}
