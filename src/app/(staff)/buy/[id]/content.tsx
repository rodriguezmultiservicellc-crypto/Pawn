'use client'

import Link from 'next/link'
import {
  ArrowLeft,
  CheckCircle,
  Coins,
  Printer,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { formatMoney, shortDateTime } from '@/lib/format/money'

export type BuyReceiptItem = {
  inventoryId: string | null
  sku: string
  description: string
  category: string | null
  metal: string | null
  karat: string | null
  weightGrams: number | null
  payout: number
  meltAtBuy: number | null
  serialNumber: string | null
  liveStatus: string | null
  holdUntil: string | null
}

export type BuyReceiptView = {
  transactionId: string
  occurredAt: string | null
  totalPayout: number
  customer: {
    name: string
    idNumber: string | null
    idType: string | null
    phone: string | null
    email: string | null
    address: string
  }
  items: BuyReceiptItem[]
}

function fmt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return formatMoney(n)
}

export default function BuyReceiptContent({
  view,
}: {
  view: BuyReceiptView
}) {
  const { t } = useI18n()
  const r = t.buy.buyReceipt
  const summary = (view.items.length === 1 ? r.summaryOne : r.summaryMany)
    .replace('{count}', String(view.items.length))
    .replace('{amount}', fmt(view.totalPayout))

  return (
    <div className="space-y-6 print:max-w-none">
      <header className="flex items-center justify-between print:hidden">
        <Link
          href="/inventory"
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft size={14} weight="bold" />
          {r.backToInventory}
        </Link>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() =>
              // Open the bilingual PDF receipt in a new tab. Browser's
              // PDF viewer surfaces the print button. window.print() of
              // the HTML page would print the staff UI, not a customer
              // receipt.
              view.items[0]?.inventoryId
                ? window.open(
                    `/api/print/buy/${view.items[0].inventoryId}`,
                    '_blank',
                  )
                : null
            }
            disabled={!view.items[0]?.inventoryId}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground hover:bg-background disabled:opacity-50"
          >
            <Printer size={14} weight="bold" />
            {r.print}
          </button>
          <Link
            href="/buy/new"
            className="inline-flex items-center gap-1 rounded-md bg-gold px-3 py-1.5 text-sm font-medium text-navy hover:bg-gold-2"
          >
            <Coins size={14} weight="bold" />
            {r.newBuy}
          </Link>
        </div>
      </header>

      <div className="rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm text-success print:border-0 print:bg-transparent print:px-0">
        <div className="flex items-center gap-2">
          <CheckCircle size={16} weight="bold" />
          <span className="font-semibold">{r.completed}</span>
        </div>
        <div className="mt-0.5 text-xs text-foreground/80">
          {summary}
          {view.occurredAt
            ? ` ${r.on.replace('{when}', shortDateTime(view.occurredAt))}`
            : ''}
        </div>
      </div>

      <article className="rounded-xl border border-border bg-card p-5 print:border-0 print:p-0">
        <header className="border-b border-border pb-3">
          <h1 className="font-display flex items-center gap-2 text-2xl font-bold text-foreground">
            <Coins size={22} weight="bold" />
            {r.title}
          </h1>
          <div className="mt-1 font-mono text-[11px] text-muted">
            {r.tx}: {view.transactionId}
          </div>
        </header>

        <section className="mt-4">
          <h2 className="text-xs font-bold uppercase tracking-wide text-muted">
            {r.customer}
          </h2>
          <div className="mt-1 text-sm text-foreground">
            <div className="font-medium">{view.customer.name}</div>
            {view.customer.address ? (
              <div className="text-xs text-muted">{view.customer.address}</div>
            ) : null}
            <div className="mt-1 grid grid-cols-2 gap-1 text-xs text-muted">
              {view.customer.phone ? (
                <div>
                  <span className="text-muted">{r.phone}:</span>{' '}
                  <span className="font-mono text-foreground">
                    {view.customer.phone}
                  </span>
                </div>
              ) : null}
              {view.customer.email ? (
                <div>
                  <span className="text-muted">{r.email}:</span>{' '}
                  <span className="font-mono text-foreground">
                    {view.customer.email}
                  </span>
                </div>
              ) : null}
              {view.customer.idType ? (
                <div>
                  <span className="text-muted">{r.id}:</span>{' '}
                  <span className="font-mono text-foreground">
                    {view.customer.idType}
                    {view.customer.idNumber
                      ? ` · ${view.customer.idNumber}`
                      : ''}
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className="mt-5">
          <h2 className="text-xs font-bold uppercase tracking-wide text-muted">
            {r.items}
          </h2>
          <table className="mt-2 w-full text-sm">
            <thead className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="py-1">{r.colSku}</th>
                <th className="py-1">{r.colDescription}</th>
                <th className="py-1">{r.colMetal}</th>
                <th className="py-1">{r.colWeight}</th>
                <th className="py-1">{r.colMelt}</th>
                <th className="py-1 text-right">{r.colPayout}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {view.items.map((it, i) => (
                <tr key={i}>
                  <td className="py-1.5 font-mono text-xs">
                    {it.inventoryId ? (
                      <Link
                        href={`/inventory/${it.inventoryId}`}
                        className="text-foreground hover:underline print:no-underline"
                      >
                        {it.sku}
                      </Link>
                    ) : (
                      it.sku
                    )}
                  </td>
                  <td className="py-1.5 text-xs">
                    <div className="text-foreground">{it.description}</div>
                    {it.serialNumber ? (
                      <div className="font-mono text-[10px] text-muted">
                        {r.serial.replace('{serial}', it.serialNumber)}
                      </div>
                    ) : null}
                    {it.liveStatus ? (
                      <div className="mt-0.5 text-[10px] text-muted">
                        {r.status.replace('{status}', it.liveStatus)}
                        {it.holdUntil
                          ? ` · ${r.holdUntil.replace('{date}', it.holdUntil)}`
                          : ''}
                      </div>
                    ) : null}
                  </td>
                  <td className="py-1.5 text-xs">
                    {it.metal
                      ? (t.spotPrices.metals as Record<string, string>)[it.metal] ?? it.metal
                      : '—'}
                    {it.karat ? (
                      <span className="ml-1 text-muted">{it.karat}K</span>
                    ) : null}
                  </td>
                  <td className="py-1.5 font-mono text-xs">
                    {it.weightGrams != null ? `${it.weightGrams}g` : '—'}
                  </td>
                  <td className="py-1.5 font-mono text-xs">
                    {fmt(it.meltAtBuy)}
                  </td>
                  <td className="py-1.5 text-right font-mono text-xs font-semibold">
                    {fmt(it.payout)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-navy">
                <td colSpan={5} className="py-2 text-right text-xs uppercase tracking-wide text-muted">
                  {r.total}
                </td>
                <td className="py-2 text-right font-mono text-base font-bold">
                  {fmt(view.totalPayout)}
                </td>
              </tr>
            </tfoot>
          </table>
        </section>

        <section className="mt-6 grid grid-cols-2 gap-4 border-t border-border pt-4 text-xs text-muted">
          <div>
            <div className="mb-8 text-[10px] uppercase tracking-wide">
              {r.customerSignature}
            </div>
            <div className="border-t border-navy"></div>
          </div>
          <div>
            <div className="mb-8 text-[10px] uppercase tracking-wide">
              {r.staffSignature}
            </div>
            <div className="border-t border-navy"></div>
          </div>
        </section>

        <footer className="mt-4 text-[10px] text-muted">{r.footer}</footer>
      </article>
    </div>
  )
}
