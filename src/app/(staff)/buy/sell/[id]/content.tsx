'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  CashRegister,
  CheckCircle,
  Coins,
  Printer,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { formatMoney, shortDateTime } from '@/lib/format/money'
import MetalTotalsTable from '@/components/buy/MetalTotalsTable'
import { pctLabel } from '@/components/buy/EntryModeToggle'
import { sumGrams, totalsByPurity } from '@/lib/metal-counter/math'
import type { MetalPurity, MetalType, PaymentMethod } from '@/types/database-aliases'

export type MetalSaleLineView = {
  id: string
  inventoryItemId: string | null
  description: string
  metal: MetalType | null
  purity: MetalPurity | null
  grams: number | null
  spotPerGram: number | null
  rateMultiplier: number | null
  price: number
}

export type MetalSaleView = {
  id: string
  saleNumber: string
  status: string
  completedAt: string | null
  customerId: string | null
  customerName: string | null
  counterpartyName: string | null
  subtotal: number
  taxRate: number
  taxAmount: number
  total: number
  notes: string | null
  registerAttached: boolean
  hasRetail: boolean
  lines: MetalSaleLineView[]
  payments: Array<{ id: string; method: PaymentMethod; amount: number; occurredAt: string }>
}

export default function MetalSaleReceiptContent({ view }: { view: MetalSaleView }) {
  const { t } = useI18n()
  const r = t.buy.receipt
  const groups = useMemo(
    () =>
      totalsByPurity(
        view.lines.map((l) => ({ metal: l.metal, purity: l.purity, grams: l.grams, dollars: l.price })),
      ),
    [view.lines],
  )
  const totalGrams = sumGrams(view.lines)

  const summary = (view.lines.length === 1 ? r.summaryOne : r.summaryMany)
    .replace('{count}', String(view.lines.length))
    .replace('{amount}', formatMoney(view.total))

  const buyer =
    [view.customerName, view.counterpartyName].filter(Boolean).join(' · ') || r.walkIn

  const methodLabel = (m: PaymentMethod): string => {
    switch (m) {
      case 'cash':
        return t.pos.payment.methodCash
      case 'transfer':
        return t.pos.payment.methodTransfer
      case 'check':
        return t.pos.payment.methodCheck
      case 'card':
        return t.pos.payment.methodCard
      case 'store_credit':
        return t.storeCredit.title
      default:
        return t.pos.payment.methodOther
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/buy/sell"
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft size={14} weight="bold" />
          {r.backToCounter}
        </Link>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => window.open(`/api/print/sale/${view.id}`, '_blank')}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground hover:bg-background"
          >
            <Printer size={14} weight="bold" />
            {r.print}
          </button>
          {view.hasRetail ? (
            <Link
              href={`/pos/sales/${view.id}`}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground hover:bg-background"
            >
              <CashRegister size={14} weight="bold" />
              {r.openInPos}
            </Link>
          ) : null}
          <Link
            href="/buy/sell"
            className="inline-flex items-center gap-1 rounded-md bg-gold px-3 py-1.5 text-sm font-medium text-navy hover:bg-gold-2"
          >
            <Coins size={14} weight="bold" />
            {r.newSale}
          </Link>
        </div>
      </header>

      <div className="rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm text-success">
        <div className="flex items-center gap-2">
          <CheckCircle size={16} weight="bold" />
          <span className="font-semibold">{r.completed}</span>
        </div>
        <div className="mt-0.5 text-xs text-foreground/80">
          {summary}
          {view.completedAt ? ` · ${shortDateTime(view.completedAt)}` : ''}
        </div>
      </div>

      <article className="rounded-xl border border-border bg-card p-5">
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-3">
          <h1 className="font-display flex items-center gap-2 text-2xl font-bold text-foreground">
            <Coins size={22} weight="bold" />
            {r.title}
          </h1>
          <div className="font-mono text-sm text-muted">
            {r.saleNumber} <span className="text-foreground">{view.saleNumber}</span>
          </div>
        </header>

        <section className="mt-4 grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-muted">{r.buyer}</div>
            <div className="mt-1 text-foreground">
              {view.customerId && view.customerName ? (
                <Link href={`/customers/${view.customerId}`} className="hover:underline">
                  {view.customerName}
                </Link>
              ) : null}
              {view.customerId && view.customerName && view.counterpartyName ? ' · ' : null}
              {view.counterpartyName ?? (!view.customerName ? buyer : null)}
            </div>
          </div>
          <div className="text-xs text-muted">
            {view.registerAttached ? t.buy.sell.registerAttached : t.buy.sell.registerNone}
          </div>
        </section>

        <section className="mt-5">
          <h2 className="text-xs font-bold uppercase tracking-wide text-muted">{r.lines}</h2>
          <div className="overflow-x-auto">
            <table className="mt-2 w-full text-sm">
              <thead className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="py-1">{r.colDescription}</th>
                  <th className="py-1">{r.colMetal}</th>
                  <th className="py-1 text-right">{r.colGrams}</th>
                  <th className="py-1 text-right">{r.colSpot}</th>
                  <th className="py-1 text-right">{r.colRate}</th>
                  <th className="py-1 text-right">{r.colPrice}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {view.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="py-1.5 text-xs text-foreground">
                      {l.inventoryItemId ? (
                        <Link href={`/inventory/${l.inventoryItemId}`} className="hover:underline">
                          {l.description}
                        </Link>
                      ) : (
                        l.description
                      )}
                    </td>
                    <td className="py-1.5 text-xs text-foreground">
                      {l.metal ? t.spotPrices.metals[l.metal] ?? l.metal : '—'}
                      {l.purity ? (
                        <span className="ml-1 text-muted">{t.spotPrices.purities[l.purity] ?? l.purity}</span>
                      ) : null}
                    </td>
                    <td className="py-1.5 text-right font-mono text-xs tabular-nums">
                      {l.grams == null ? '—' : `${l.grams.toFixed(3)} g`}
                    </td>
                    <td className="py-1.5 text-right font-mono text-xs tabular-nums">
                      {l.spotPerGram == null ? '—' : formatMoney(l.spotPerGram)}
                    </td>
                    <td className="py-1.5 text-right font-mono text-xs tabular-nums">
                      {l.rateMultiplier == null ? '—' : `${pctLabel(l.rateMultiplier)}%`}
                    </td>
                    <td className="py-1.5 text-right font-mono text-xs font-semibold tabular-nums">
                      {formatMoney(l.price)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="text-xs">
                <tr className="border-t border-border">
                  <td colSpan={5} className="py-1 text-right uppercase tracking-wide text-muted">
                    {r.subtotal}
                  </td>
                  <td className="py-1 text-right font-mono tabular-nums">{formatMoney(view.subtotal)}</td>
                </tr>
                <tr>
                  <td colSpan={5} className="py-1 text-right uppercase tracking-wide text-muted">
                    {r.tax} ({pctLabel(view.taxRate)}%)
                  </td>
                  <td className="py-1 text-right font-mono tabular-nums">{formatMoney(view.taxAmount)}</td>
                </tr>
                <tr className="border-t-2 border-navy">
                  <td colSpan={5} className="py-2 text-right uppercase tracking-wide text-muted">
                    {r.total}
                  </td>
                  <td className="py-2 text-right font-mono text-base font-bold tabular-nums">
                    {formatMoney(view.total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        {groups.length > 0 ? (
          <section className="mt-5">
            <MetalTotalsTable
              groups={groups}
              totalGrams={totalGrams}
              totalDollars={view.subtotal}
              amountLabel={r.colPrice}
            />
          </section>
        ) : null}

        <section className="mt-5">
          <h2 className="text-xs font-bold uppercase tracking-wide text-muted">{r.payments}</h2>
          <table className="mt-2 w-full text-sm">
            <thead className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="py-1">{r.colMethod}</th>
                <th className="py-1">{r.colWhen}</th>
                <th className="py-1 text-right">{r.colAmount}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {view.payments.map((p) => (
                <tr key={p.id}>
                  <td className="py-1.5 text-xs text-foreground">{methodLabel(p.method)}</td>
                  <td className="py-1.5 font-mono text-xs text-muted">{shortDateTime(p.occurredAt)}</td>
                  <td className="py-1.5 text-right font-mono text-xs tabular-nums">{formatMoney(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {view.notes ? (
          <section className="mt-5 text-sm">
            <div className="text-xs font-bold uppercase tracking-wide text-muted">{t.buy.form.notes}</div>
            <p className="mt-1 whitespace-pre-wrap text-foreground">{view.notes}</p>
          </section>
        ) : null}

        <footer className="mt-5 border-t border-border pt-3 text-[10px] text-muted">{r.footer}</footer>
      </article>
    </div>
  )
}
