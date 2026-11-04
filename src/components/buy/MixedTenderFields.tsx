'use client'

import { useI18n } from '@/lib/i18n/context'
import { formatMoney } from '@/lib/format/money'
import { mixedRemaining, parseNum } from '@/lib/metal-counter/math'

/**
 * Cash + transfer split for a 'mixed' tender (brief Phase 3). Renders the
 * two amount inputs (`paid_cash`, `paid_transfer`) and a live hint for
 * what is still unallocated; the server re-validates the split with
 * splitTenders(), so this is convenience, not enforcement.
 */
export default function MixedTenderFields({
  total,
  cash,
  transfer,
  onCashChange,
  onTransferChange,
}: {
  total: number
  cash: string
  transfer: string
  onCashChange: (v: string) => void
  onTransferChange: (v: string) => void
}) {
  const { t } = useI18n()
  const f = t.buy.form
  const remaining = mixedRemaining(total, parseNum(cash), parseNum(transfer))
  const balanced = Math.abs(remaining) < 0.005

  const inputClass =
    'block w-full rounded-md border border-border bg-card px-3 py-2 text-right font-mono text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10'

  return (
    <div className="mt-3 grid grid-cols-1 gap-3 rounded-md border border-border bg-background/40 p-3 md:grid-cols-3">
      <label className="block space-y-1">
        <span className="text-xs font-medium text-foreground">{f.mixedCash}</span>
        <input
          name="paid_cash"
          type="number"
          step="0.01"
          min="0"
          inputMode="decimal"
          value={cash}
          onChange={(e) => onCashChange(e.target.value)}
          className={inputClass}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-foreground">{f.mixedTransfer}</span>
        <input
          name="paid_transfer"
          type="number"
          step="0.01"
          min="0"
          inputMode="decimal"
          value={transfer}
          onChange={(e) => onTransferChange(e.target.value)}
          className={inputClass}
        />
      </label>
      <div className="flex items-end">
        <p
          className={`text-xs ${balanced ? 'text-success' : remaining < 0 ? 'text-danger' : 'text-warning'}`}
          role="status"
        >
          {balanced
            ? f.mixedBalanced
            : remaining < 0
              ? f.mixedOver.replace('{amount}', formatMoney(-remaining))
              : f.mixedRemaining.replace('{amount}', formatMoney(remaining))}
        </p>
      </div>
    </div>
  )
}

/** Client mirror of splitTenders' acceptance test — disables the submit button. */
export function mixedSplitOk(total: number, cash: string, transfer: string): boolean {
  return Math.abs(mixedRemaining(total, parseNum(cash), parseNum(transfer))) < 0.005
}
