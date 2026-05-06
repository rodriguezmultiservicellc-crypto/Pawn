'use client'

import { useActionState, useEffect } from 'react'
import {
  resetReferralCodeAction,
  type ResetReferralCodeState,
} from '@/app/(staff)/customers/[id]/actions'

const INITIAL_STATE: ResetReferralCodeState = {}

export default function ResetReferralCodeForm({
  customerId,
  onCancel,
  onSuccess,
}: {
  customerId: string
  onCancel: () => void
  onSuccess: () => void
}) {
  const [state, formAction, pending] = useActionState<
    ResetReferralCodeState,
    FormData
  >(resetReferralCodeAction, INITIAL_STATE)

  useEffect(() => {
    if (state.ok) onSuccess()
  }, [state.ok, onSuccess])

  return (
    <form
      action={formAction}
      className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-background px-3 py-2"
    >
      <input type="hidden" name="customer_id" value={customerId} />
      <span className="text-sm text-foreground">
        Reset code? The old code will stop working.
      </span>
      <button
        type="button"
        onClick={onCancel}
        disabled={pending}
        className="rounded-md border border-border bg-card px-3 py-1 text-sm text-foreground hover:bg-background disabled:opacity-50"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-gold px-3 py-1 text-sm font-medium text-navy hover:bg-gold/90 disabled:opacity-50"
      >
        {pending ? 'Resetting…' : 'Reset code'}
      </button>
      {state.error && (
        <span className="text-sm text-danger" role="alert">
          {state.error}
        </span>
      )}
    </form>
  )
}
