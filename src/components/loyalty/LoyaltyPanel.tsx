'use client'

import { useState } from 'react'
import { Trophy, Copy, Check, ArrowClockwise } from '@phosphor-icons/react'
import AdjustPointsModal from './AdjustPointsModal'
import ResetReferralCodeForm from './ResetReferralCodeForm'

export type LoyaltyEventView = {
  id: string
  kind:
    | 'earn_sale'
    | 'earn_loan_interest'
    | 'earn_referral_bonus'
    | 'redeem_pos'
    | 'redeem_undo'
    | 'earn_clawback'
    | 'adjust_manual'
  points_delta: number
  reason: string | null
  created_at: string
}

const KIND_LABEL: Record<LoyaltyEventView['kind'], string> = {
  earn_sale: 'Retail purchase',
  earn_loan_interest: 'Loan interest',
  earn_referral_bonus: 'Referral bonus',
  redeem_pos: 'Redeemed at checkout',
  redeem_undo: 'Reverted redemption',
  earn_clawback: 'Sale reversed',
  adjust_manual: 'Adjustment',
}

export default function LoyaltyPanel({
  enabled,
  customer,
  recentEvents,
  redemptionRate,
  canAdjust,
}: {
  enabled: boolean
  customer: {
    id: string
    first_name: string
    last_name: string
    loyalty_points_balance: number
    referral_code: string | null
    is_banned: boolean
  }
  recentEvents: LoyaltyEventView[]
  redemptionRate: number
  canAdjust: boolean
}) {
  const [showModal, setShowModal] = useState(false)
  const [copied, setCopied] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)

  if (!enabled) {
    return (
      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-2 text-sm text-muted">
          <Trophy size={18} weight="regular" />
          <span>Loyalty disabled for this shop. Enable in /settings/loyalty.</span>
        </div>
      </section>
    )
  }

  const equivDollars = customer.loyalty_points_balance / redemptionRate
  const code = customer.referral_code

  const copyCode = async () => {
    if (!code) return
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard unavailable; do nothing
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-4 flex items-center gap-2">
        <Trophy size={20} weight="fill" className="text-gold" />
        <h2 className="text-lg font-semibold text-foreground">Loyalty</h2>
      </div>

      <div className="mb-4">
        <div className="font-mono text-3xl font-bold text-foreground">
          {customer.loyalty_points_balance.toLocaleString()}
        </div>
        <div className="text-sm text-muted">
          ≈ ${equivDollars.toFixed(2)} in store credit
        </div>
      </div>

      {code && (
        <div className="mb-4 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted">Referral code:</span>
            <code className="rounded bg-background px-2 py-1 font-mono text-sm text-foreground">
              {code}
            </code>
            <button
              type="button"
              onClick={copyCode}
              className="rounded p-1 text-muted hover:bg-background hover:text-foreground"
              title="Copy"
              aria-label="Copy code"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
            {canAdjust && !customer.is_banned && !confirmReset && (
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                className="rounded p-1 text-muted hover:bg-background hover:text-foreground"
                title="Reset code"
                aria-label="Reset code"
              >
                <ArrowClockwise size={14} />
              </button>
            )}
          </div>
          {confirmReset && (
            <ResetReferralCodeForm
              customerId={customer.id}
              onCancel={() => setConfirmReset(false)}
              onSuccess={() => setConfirmReset(false)}
            />
          )}
        </div>
      )}

      <h3 className="mb-2 text-sm font-medium text-foreground">Recent activity</h3>
      {recentEvents.length === 0 ? (
        <p className="text-sm text-muted">No activity yet.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {recentEvents.map((e) => (
            <li
              key={e.id}
              className="flex items-center justify-between gap-2 border-b border-border py-1.5 last:border-b-0"
            >
              <span className="text-foreground">{KIND_LABEL[e.kind]}</span>
              <span
                className={`font-mono ${
                  e.points_delta >= 0 ? 'text-success' : 'text-danger'
                }`}
              >
                {e.points_delta >= 0 ? '+' : ''}
                {e.points_delta.toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}

      {canAdjust && !customer.is_banned && (
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="mt-4 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground hover:bg-background"
        >
          Adjust points
        </button>
      )}

      <AdjustPointsModal
        open={showModal}
        onClose={() => setShowModal(false)}
        customerId={customer.id}
        customerName={`${customer.first_name} ${customer.last_name}`}
      />
    </section>
  )
}
