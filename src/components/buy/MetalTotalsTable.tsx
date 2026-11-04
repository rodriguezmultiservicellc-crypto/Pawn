'use client'

import { useI18n } from '@/lib/i18n/context'
import { formatMoney } from '@/lib/format/money'
import type { MetalGroupTotals } from '@/lib/metal-counter/math'

/**
 * "Several karats in one transaction — show total grams and total dollars"
 * (brief Phase 3). One row per (metal, purity) with its grams and money,
 * plus a total row. Shared by Buy Outright, Sell Metal and the metal-sale
 * receipt.
 */
export default function MetalTotalsTable({
  groups,
  totalGrams,
  totalDollars,
  amountLabel,
}: {
  groups: MetalGroupTotals[]
  totalGrams: number
  totalDollars: number
  /** Column header for the money column — "Payout" on buy, "Price" on sell. */
  amountLabel: string
}) {
  const { t } = useI18n()
  if (groups.length === 0) return null
  const f = t.buy.form
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="mb-1 text-left text-xs uppercase tracking-wide text-muted">
          {f.byKarat}
        </caption>
        <thead className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted">
          <tr>
            <th className="py-1 font-semibold">{f.colMetal}</th>
            <th className="py-1 text-right font-semibold">{f.colItems}</th>
            <th className="py-1 text-right font-semibold">{f.colGrams}</th>
            <th className="py-1 text-right font-semibold">{amountLabel}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {groups.map((g) => (
            <tr key={`${g.metal}::${g.purity}`}>
              <td className="py-1 text-foreground">
                {t.spotPrices.metals[g.metal] ?? g.metal}
                {' · '}
                {t.spotPrices.purities[g.purity] ?? g.purity}
              </td>
              <td className="py-1 text-right font-mono tabular-nums text-foreground">{g.count}</td>
              <td className="py-1 text-right font-mono tabular-nums text-foreground">
                {g.grams.toFixed(3)} g
              </td>
              <td className="py-1 text-right font-mono tabular-nums text-foreground">
                {formatMoney(g.dollars)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-navy">
            <td className="py-1.5 text-xs uppercase tracking-wide text-muted">{f.totalGrams}</td>
            <td />
            <td className="py-1.5 text-right font-mono font-bold tabular-nums text-foreground">
              {totalGrams.toFixed(3)} g
            </td>
            <td className="py-1.5 text-right font-mono font-bold tabular-nums text-foreground">
              {formatMoney(totalDollars)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
