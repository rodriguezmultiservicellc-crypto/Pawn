'use client'

import { useI18n } from '@/lib/i18n/context'
import { CARD_BRANDS, cleanAuthCode, cleanLast4, type CardBrand } from '@/lib/pos/card'

export type CardSlip = { last4: string; brand: CardBrand; auth_code: string }

export const EMPTY_SLIP: CardSlip = { last4: '', brand: 'visa', auth_code: '' }

/** Ready to submit: exactly 4 digits (brand always has a value; code optional). */
export function slipComplete(s: CardSlip): boolean {
  return /^[0-9]{4}$/.test(s.last4)
}

const INPUT =
  'block h-11 w-full rounded-xl border-2 border-border bg-background px-4 text-sm text-foreground outline-none transition-colors focus:border-blue focus-visible:outline-3 focus-visible:outline-blue'

/**
 * Last 4 / brand / approval code from a card machine slip (patches/0085).
 * Used by the New sale Charge dialog and the sale page's Add payment dialog.
 * Inputs clean as the clerk types, so what is submitted already matches the
 * database CHECKs.
 */
export function CardSlipFields({
  value,
  onChange,
  autoFocus,
}: {
  value: CardSlip
  onChange: (next: CardSlip) => void
  autoFocus?: boolean
}) {
  const { t } = useI18n()
  const c = t.pos.card
  const last4Bad = value.last4.length > 0 && value.last4.length < 4

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">{c.machineHelp}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block space-y-1">
          <span className="block text-sm font-semibold text-foreground">{c.last4}</span>
          <input
            autoFocus={autoFocus}
            inputMode="numeric"
            autoComplete="off"
            value={value.last4}
            onChange={(e) => onChange({ ...value, last4: cleanLast4(e.target.value) })}
            aria-invalid={last4Bad}
            className={`${INPUT} font-mono tracking-widest ${last4Bad ? 'border-danger' : ''}`}
            placeholder="0000"
          />
          {last4Bad ? <span className="block text-xs text-danger">{c.errLast4}</span> : null}
        </label>
        <label className="block space-y-1">
          <span className="block text-sm font-semibold text-foreground">{c.brand}</span>
          <select
            value={value.brand}
            onChange={(e) => onChange({ ...value, brand: e.target.value as CardBrand })}
            className={INPUT}
          >
            {CARD_BRANDS.map((b) => (
              <option key={b} value={b}>
                {c.brands[b]}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="block text-sm font-semibold text-foreground">{c.authCode}</span>
          <input
            autoComplete="off"
            maxLength={12}
            value={value.auth_code}
            onChange={(e) => onChange({ ...value, auth_code: cleanAuthCode(e.target.value) })}
            className={`${INPUT} font-mono uppercase`}
          />
        </label>
      </div>
    </div>
  )
}
