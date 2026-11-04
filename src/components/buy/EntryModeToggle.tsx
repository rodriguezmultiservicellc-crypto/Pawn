'use client'

import { useI18n } from '@/lib/i18n/context'

/** Which field the operator is typing — the other one is derived from it. */
export type EntryMode = 'weight' | 'amount'

/**
 * Weight | Amount segmented control for a two-way metal line (brief
 * Phase 3). Shared by Buy Outright (grams ⇄ payout at the pay rate) and
 * Sell Metal (grams ⇄ price at the sell rate).
 */
export default function EntryModeToggle({
  value,
  onChange,
  disabled,
}: {
  value: EntryMode
  onChange: (m: EntryMode) => void
  /** No rate for this line → nothing to convert with; keep Weight. */
  disabled?: boolean
}) {
  const { t } = useI18n()
  const f = t.buy.form
  const btn = (m: EntryMode, label: string) => (
    <button
      type="button"
      onClick={() => onChange(m)}
      disabled={disabled}
      aria-pressed={value === m}
      className={`px-2 py-0.5 text-[11px] font-semibold transition-colors disabled:opacity-50 ${
        value === m ? 'bg-navy text-white' : 'text-foreground hover:bg-background'
      }`}
    >
      {label}
    </button>
  )
  return (
    <div className="block text-xs">
      <span className="block text-[10px] uppercase tracking-wide text-muted">{f.enterBy}</span>
      <div className="inline-flex overflow-hidden rounded-md border border-border bg-card">
        {btn('weight', f.byWeight)}
        {btn('amount', f.byAmount)}
      </div>
    </div>
  )
}

/** "85" / "105.5" — a multiplier as a percent string for badges. */
export function pctLabel(multiplier: number): string {
  const p = multiplier * 100
  return p % 1 === 0 ? p.toFixed(0) : p.toFixed(2)
}
