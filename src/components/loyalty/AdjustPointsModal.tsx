'use client'

import { useActionState, useEffect } from 'react'
import {
  adjustLoyaltyPointsAction,
  type AdjustLoyaltyPointsState,
} from '@/app/(staff)/customers/[id]/actions'

const INITIAL_STATE: AdjustLoyaltyPointsState = {}

export default function AdjustPointsModal({
  open,
  onClose,
  customerId,
  customerName,
}: {
  open: boolean
  onClose: () => void
  customerId: string
  customerName: string
}) {
  const [state, formAction] = useActionState<AdjustLoyaltyPointsState, FormData>(
    adjustLoyaltyPointsAction,
    INITIAL_STATE,
  )

  useEffect(() => {
    if (state.ok) onClose()
  }, [state.ok, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy/30"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-lg bg-card p-6 shadow-lg">
        <h3 className="mb-1 text-lg font-semibold text-foreground">Adjust points</h3>
        <p className="mb-4 text-sm text-muted">{customerName}</p>

        <form action={formAction} className="space-y-4">
          <input type="hidden" name="customer_id" value={customerId} />
          <label className="block text-sm text-foreground">
            <span className="mb-1 block">Delta (signed integer)</span>
            <input
              type="number"
              name="delta"
              step="1"
              required
              autoFocus
              className="w-full rounded-md border border-border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gold/50"
              placeholder="e.g. 50 or -100"
            />
          </label>
          <label className="block text-sm text-foreground">
            <span className="mb-1 block">Reason (≥ 3 chars, required)</span>
            <textarea
              name="reason"
              required
              minLength={3}
              maxLength={500}
              rows={3}
              className="w-full rounded-md border border-border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gold/50"
            />
          </label>
          {state.error && (
            <p className="text-sm text-danger" role="alert">
              {state.error === 'would_go_negative'
                ? 'That adjustment would take the balance below zero.'
                : state.error === 'reason_too_short'
                  ? 'Please give a reason of at least 3 characters.'
                  : state.error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-background"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-md bg-gold px-3 py-1.5 text-sm font-medium text-navy hover:bg-gold/90"
            >
              Save adjustment
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
