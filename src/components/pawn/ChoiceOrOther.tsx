'use client'

import { useState } from 'react'
import { INPUT } from '@/lib/ui/ledger'
import { matchChoice, type Choice } from '@/lib/pawn/item-options'

const OTHER = '__other__'

/**
 * A dropdown that never loses a value: the listed choices, plus "Other…"
 * which opens a box to type in. Used for Color and Style in the item popup.
 *
 * A value that is not on the list — an older ticket's "Yellow Gold", or
 * something the clerk typed — shows under "Other" exactly as it is. What is
 * submitted (the hidden input) is the choice's saved word when the value
 * matches one, else the value as typed.
 */
export function ChoiceOrOther({
  label,
  name,
  value,
  onChange,
  choices,
  otherLabel,
  otherPlaceholder,
  className,
}: {
  label: string
  name: string
  value: string
  onChange: (value: string) => void
  choices: ReadonlyArray<Choice>
  otherLabel: string
  otherPlaceholder: string
  className?: string
}) {
  // "Other…" was picked and nothing is typed yet. With something typed that
  // is not on the list, Other shows by itself.
  const [otherOpen, setOtherOpen] = useState(false)
  const match = matchChoice(value, choices)
  const showOther = otherOpen || (value.trim() !== '' && match == null)

  return (
    <div className={`space-y-1 ${className ?? ''}`}>
      <span className="block text-xs font-semibold uppercase tracking-[0.08em] text-muted">
        {label}
      </span>
      <select
        aria-label={label}
        value={showOther ? OTHER : match?.value ?? ''}
        onChange={(e) => {
          const picked = e.target.value
          if (picked === OTHER) {
            setOtherOpen(true)
            // A listed value is not what "Other" means: start empty.
            if (match) onChange('')
            return
          }
          setOtherOpen(false)
          onChange(picked)
        }}
        className={INPUT}
      >
        <option value="">—</option>
        {choices.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
        <option value={OTHER}>{otherLabel}</option>
      </select>
      {showOther ? (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label}: ${otherLabel}`}
          placeholder={otherPlaceholder}
          autoFocus
          className={INPUT}
        />
      ) : null}
      <input type="hidden" name={name} value={match ? match.value : value.trim()} />
    </div>
  )
}
