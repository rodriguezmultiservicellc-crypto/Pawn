'use client'

import { useState } from 'react'

/**
 * Commission input: the clerk types a PERCENT, the form submits a
 * FRACTION.
 *
 * The column, the Zod schema and the accrual trigger all speak fractions
 * (0.2000 = 20%). Asking a clerk to type "0.2" for twenty percent is how
 * someone eventually types "20" and hands a consignor 2000% — so the
 * visible field is percent and a hidden field carries the converted value.
 */
export function CommissionField({
  name,
  label,
  help,
  error,
  /** Stored value as a fraction, e.g. 0.2. */
  defaultFraction,
  className,
}: {
  name: string
  label: string
  help?: string
  error?: string
  defaultFraction?: number | null
  className?: string
}) {
  const [percent, setPercent] = useState(() =>
    defaultFraction == null
      ? ''
      : String(Math.round(defaultFraction * 10000) / 100),
  )

  const parsed = Number.parseFloat(percent)
  const fraction =
    Number.isFinite(parsed) && parsed >= 0 && parsed <= 100
      ? String(Math.round((parsed / 100) * 10000) / 10000)
      : ''

  return (
    <label className={`block space-y-1 ${className ?? ''}`}>
      <span className="text-sm font-medium text-foreground">{label}</span>
      <input
        type="number"
        min="0"
        max="100"
        step="0.01"
        inputMode="decimal"
        value={percent}
        onChange={(e) => setPercent(e.target.value)}
        className={`block w-full rounded-md border bg-card px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-blue/10 ${
          error
            ? 'border-danger focus:border-danger'
            : 'border-border focus:border-blue'
        }`}
      />
      <input type="hidden" name={name} value={fraction} />
      {help ? <span className="text-xs text-muted">{help}</span> : null}
      {error ? <span className="text-xs text-danger">{error}</span> : null}
    </label>
  )
}
