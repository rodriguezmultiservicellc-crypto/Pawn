'use client'

import { useI18n } from '@/lib/i18n/context'

/** How the shop pays the seller. 'store_credit' writes a credit ledger row
 *  instead of handing over cash (patches/0053); 'mixed' is cash + transfer
 *  split into two tenders by the action (brief Phase 3). The server's list is
 *  buyPayoutMethodSchema (lib/validations/buy-outright). */
export type BuyPayoutMethod =
  | 'cash'
  | 'transfer'
  | 'card'
  | 'check'
  | 'other'
  | 'store_credit'
  | 'mixed'

export const BUY_PAYOUT_METHODS: readonly BuyPayoutMethod[] = [
  'cash',
  'transfer',
  'card',
  'check',
  'other',
  'store_credit',
  'mixed',
]

export function isBuyPayoutMethod(v: string): v is BuyPayoutMethod {
  return (BUY_PAYOUT_METHODS as readonly string[]).includes(v)
}

/**
 * The payout method of a buy (`payment_method`): Buy outright and a
 * purchase on the transaction form. Store credit is offered only when the
 * shop has it on. Pair with MixedTenderFields for 'mixed'.
 */
export default function BuyPayoutSelect({
  value,
  onChange,
  storeCreditEnabled,
  labelClassName = 'text-xs uppercase tracking-wide text-muted',
  selectClassName = 'w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm',
}: {
  value: BuyPayoutMethod
  onChange: (v: BuyPayoutMethod) => void
  storeCreditEnabled: boolean
  labelClassName?: string
  selectClassName?: string
}) {
  const { t } = useI18n()
  return (
    <label className="block space-y-1">
      <span className={`block ${labelClassName}`}>{t.pos.payment.method}</span>
      <select
        name="payment_method"
        value={value}
        onChange={(e) => onChange(e.target.value as BuyPayoutMethod)}
        className={selectClassName}
      >
        <option value="cash">{t.pos.payment.methodCash}</option>
        <option value="transfer">{t.pos.payment.methodTransfer}</option>
        <option value="mixed">{t.buy.form.paymentMixed}</option>
        <option value="check">{t.pos.payment.methodCheck}</option>
        <option value="card">{t.pos.payment.methodCard}</option>
        <option value="other">{t.pos.payment.methodOther}</option>
        {storeCreditEnabled ? (
          <option value="store_credit">{t.storeCredit.buyPayout}</option>
        ) : null}
      </select>
      {value === 'store_credit' ? (
        <span className="block text-xs text-muted">{t.storeCredit.buyPayoutHelp}</span>
      ) : null}
    </label>
  )
}
