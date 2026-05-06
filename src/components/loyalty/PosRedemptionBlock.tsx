'use client'

import { useActionState, useState } from 'react'
import {
  redeemPointsOnSaleAction,
  undoRedemptionAction,
  type RedeemPointsState,
  type UndoRedemptionState,
} from '@/app/(staff)/pos/sales/[id]/actions'

export type RedemptionEventView = {
  id: string
  points_delta: number
  created_at: string
}

const REDEEM_INITIAL: RedeemPointsState = {}
const UNDO_INITIAL: UndoRedemptionState = {}

export default function PosRedemptionBlock({
  saleId,
  customerFirstName,
  balance,
  redemptionRate,
  saleStatus,
  redemptionsOnThisSale,
}: {
  saleId: string
  customerFirstName: string
  balance: number
  redemptionRate: number
  saleStatus: string
  redemptionsOnThisSale: RedemptionEventView[]
}) {
  const [points, setPoints] = useState('')
  const [redeemState, redeemAction] = useActionState<RedeemPointsState, FormData>(
    redeemPointsOnSaleAction,
    REDEEM_INITIAL,
  )
  const [undoState, undoAction] = useActionState<UndoRedemptionState, FormData>(
    undoRedemptionAction,
    UNDO_INITIAL,
  )
  void undoState

  if (saleStatus !== 'open') return null
  if (balance <= 0 && redemptionsOnThisSale.length === 0) return null

  const pointsNum = Number.parseInt(points, 10)
  const previewDiscount =
    Number.isFinite(pointsNum) && pointsNum > 0 && redemptionRate > 0
      ? Math.round((pointsNum / redemptionRate) * 100) / 100
      : 0

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold text-foreground">Loyalty</h3>

      {balance > 0 && (
        <p className="mb-3 text-sm text-muted">
          {customerFirstName} has{' '}
          <span className="font-mono text-foreground">{balance.toLocaleString()}</span>{' '}
          points (≈ ${(balance / redemptionRate).toFixed(2)})
        </p>
      )}

      {balance > 0 && (
        <form action={redeemAction} className="mb-4 flex items-end gap-3">
          <input type="hidden" name="sale_id" value={saleId} />
          <label className="text-sm text-foreground">
            <span className="mb-1 block">Redeem points</span>
            <input
              type="number"
              name="points"
              min="1"
              max={balance}
              step="1"
              value={points}
              onChange={(e) => setPoints(e.target.value)}
              className="w-32 rounded-md border border-border px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-gold/50"
            />
          </label>
          <span className="pb-2 text-sm text-muted">
            → ${previewDiscount.toFixed(2)} discount
          </span>
          <button
            type="submit"
            disabled={pointsNum <= 0 || pointsNum > balance}
            className="rounded-md bg-gold px-3 py-2 text-sm font-medium text-navy hover:bg-gold/90 disabled:opacity-60"
          >
            Apply redemption
          </button>
        </form>
      )}

      {redeemState.error && (
        <p className="mb-3 text-sm text-danger" role="alert">
          {redeemState.error}
        </p>
      )}

      {redemptionsOnThisSale.length > 0 && (
        <div className="space-y-2">
          {redemptionsOnThisSale.map((r) => {
            const undone = false // future: track undo events
            const restoreApprox =
              Math.round((Math.abs(r.points_delta) / redemptionRate) * 100) / 100
            return (
              <div
                key={r.id}
                className="flex items-center justify-between rounded-md bg-background px-3 py-2 text-sm"
              >
                <span className="text-foreground">
                  Redeemed{' '}
                  <span className="font-mono">
                    {Math.abs(r.points_delta).toLocaleString()}
                  </span>{' '}
                  pts for ${restoreApprox.toFixed(2)}
                </span>
                {!undone && (
                  <form action={undoAction}>
                    <input type="hidden" name="sale_id" value={saleId} />
                    <input type="hidden" name="event_id" value={r.id} />
                    <button
                      type="submit"
                      className="text-xs text-muted underline hover:text-foreground"
                    >
                      Undo
                    </button>
                  </form>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
