'use client'

import Link from 'next/link'
import {
  ArrowLeft,
  CheckCircle,
  Coins,
  Printer,
} from '@phosphor-icons/react'

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
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  })
}

export default function BuyReceiptContent({
  view,
}: {
  view: BuyReceiptView
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-6 print:max-w-none">
      <header className="flex items-center justify-between print:hidden">
        <Link
          href="/inventory"
          className="inline-flex items-center gap-1 text-sm text-ash hover:text-ink"
        >
          <ArrowLeft size={14} weight="bold" />
          Back to inventory
        </Link>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1 rounded-md border border-hairline bg-canvas px-3 py-1.5 text-sm text-ink hover:bg-cloud"
          >
            <Printer size={14} weight="bold" />
            Print
          </button>
          <Link
            href="/buy/new"
            className="inline-flex items-center gap-1 rounded-md bg-rausch px-3 py-1.5 text-sm font-medium text-canvas hover:bg-rausch-deep"
          >
            <Coins size={14} weight="bold" />
            New buy
          </Link>
        </div>
      </header>

      <div className="rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm text-success print:border-0 print:bg-transparent print:px-0">
        <div className="flex items-center gap-2">
          <CheckCircle size={16} weight="bold" />
          <span className="font-semibold">Buy completed</span>
        </div>
        <div className="mt-0.5 text-xs text-ink/80">
          {view.items.length} item{view.items.length === 1 ? '' : 's'} purchased
          for <span className="font-mono font-bold">{fmt(view.totalPayout)}</span>
          {view.occurredAt
            ? ` on ${new Date(view.occurredAt).toLocaleString()}`
            : ''}
          .
        </div>
      </div>

      <article className="rounded-lg border border-hairline bg-canvas p-5 print:border-0 print:p-0">
        <header className="border-b border-hairline pb-3">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-ink">
            <Coins size={22} weight="bold" />
            Buy receipt
          </h1>
          <div className="mt-1 font-mono text-[11px] text-ash">
            Tx: {view.transactionId}
          </div>
        </header>

        <section className="mt-4">
          <h2 className="text-xs font-bold uppercase tracking-wide text-ash">
            Customer
          </h2>
          <div className="mt-1 text-sm text-ink">
            <div className="font-medium">{view.customer.name}</div>
            {view.customer.address ? (
              <div className="text-xs text-ash">{view.customer.address}</div>
            ) : null}
            <div className="mt-1 grid grid-cols-2 gap-1 text-xs text-ash">
              {view.customer.phone ? (
                <div>
                  <span className="text-ash">Phone:</span>{' '}
                  <span className="font-mono text-ink">
                    {view.customer.phone}
                  </span>
                </div>
              ) : null}
              {view.customer.email ? (
                <div>
                  <span className="text-ash">Email:</span>{' '}
                  <span className="font-mono text-ink">
                    {view.customer.email}
                  </span>
                </div>
              ) : null}
              {view.customer.idType ? (
                <div>
                  <span className="text-ash">ID:</span>{' '}
                  <span className="font-mono text-ink">
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
          <h2 className="text-xs font-bold uppercase tracking-wide text-ash">
            Items
          </h2>
          <table className="mt-2 w-full text-sm">
            <thead className="border-b border-hairline text-left text-[11px] uppercase tracking-wide text-ash">
              <tr>
                <th className="py-1">SKU</th>
                <th className="py-1">Description</th>
                <th className="py-1">Metal</th>
                <th className="py-1">Weight</th>
                <th className="py-1">Melt</th>
                <th className="py-1 text-right">Payout</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {view.items.map((it, i) => (
                <tr key={i}>
                  <td className="py-1.5 font-mono text-xs">
                    {it.inventoryId ? (
                      <Link
                        href={`/inventory/${it.inventoryId}`}
                        className="text-ink hover:underline print:no-underline"
                      >
                        {it.sku}
                      </Link>
                    ) : (
                      it.sku
                    )}
                  </td>
                  <td className="py-1.5 text-xs">
                    <div className="text-ink">{it.description}</div>
                    {it.serialNumber ? (
                      <div className="font-mono text-[10px] text-ash">
                        SN {it.serialNumber}
                      </div>
                    ) : null}
                    {it.liveStatus ? (
                      <div className="mt-0.5 text-[10px] text-ash">
                        Status: {it.liveStatus}
                        {it.holdUntil ? ` · hold until ${it.holdUntil}` : ''}
                      </div>
                    ) : null}
                  </td>
                  <td className="py-1.5 text-xs">
                    {it.metal ?? '—'}
                    {it.karat ? (
                      <span className="ml-1 text-ash">{it.karat}K</span>
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
              <tr className="border-t-2 border-ink">
                <td colSpan={5} className="py-2 text-right text-xs uppercase tracking-wide text-ash">
                  Total
                </td>
                <td className="py-2 text-right font-mono text-base font-bold">
                  {fmt(view.totalPayout)}
                </td>
              </tr>
            </tfoot>
          </table>
        </section>

        <section className="mt-6 grid grid-cols-2 gap-4 border-t border-hairline pt-4 text-xs text-ash">
          <div>
            <div className="mb-8 text-[10px] uppercase tracking-wide">
              Customer signature
            </div>
            <div className="border-t border-ink"></div>
          </div>
          <div>
            <div className="mb-8 text-[10px] uppercase tracking-wide">
              Staff signature
            </div>
            <div className="border-t border-ink"></div>
          </div>
        </section>

        <footer className="mt-4 text-[10px] text-ash">
          This transaction has been recorded in the police-report
          compliance log per FL pawn-statute requirements. Items are held
          for the state-mandated period before being available for sale.
        </footer>
      </article>
    </div>
  )
}
