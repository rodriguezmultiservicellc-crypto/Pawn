'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Wallet } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { formatMoney } from '@/lib/format/money'
import type { StoreCreditEventKind } from '@/types/database-aliases'
import AdjustStoreCreditModal from './AdjustStoreCreditModal'

export type StoreCreditEventView = {
  id: string
  kind: StoreCreditEventKind
  amount_delta: number
  reason: string | null
  created_at: string
}

/**
 * Customer detail → store-credit balance and recent ledger.
 *
 * Rendered even when the module is off, so a shop that switches it off
 * does not lose sight of credit it still owes — it just cannot move it.
 */
export default function StoreCreditPanel({
  enabled,
  customerId,
  customerName,
  balance,
  recentEvents,
  canAdjust,
}: {
  enabled: boolean
  customerId: string
  customerName: string
  balance: number
  recentEvents: StoreCreditEventView[]
  canAdjust: boolean
}) {
  const { t } = useI18n()
  const ts = t.storeCredit
  const [showAdjust, setShowAdjust] = useState(false)

  // Nothing owed and the module is off: no reason to take up space.
  if (!enabled && balance === 0 && recentEvents.length === 0) return null

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gold/10 text-gold">
            <Wallet size={18} weight="bold" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              {ts.title}
            </h2>
            <p className="text-xs text-muted">
              {enabled ? ts.panel.subtitle : ts.disabled}
            </p>
          </div>
        </div>
        {canAdjust && enabled ? (
          <button
            type="button"
            onClick={() => setShowAdjust(true)}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground hover:bg-background"
          >
            {ts.panel.adjustButton}
          </button>
        ) : null}
      </div>

      <div className="mb-4">
        <div className="font-mono text-3xl font-bold text-foreground">
          {formatMoney(balance)}
        </div>
        <div className="text-xs uppercase tracking-wide text-muted">
          {ts.balance}
        </div>
      </div>

      <h3 className="mb-2 text-sm font-medium text-foreground">
        {ts.panel.recentActivity}
      </h3>
      {recentEvents.length === 0 ? (
        <p className="text-sm text-muted">{ts.panel.noActivity}</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {recentEvents.map((e) => (
            <li
              key={e.id}
              className="flex items-center justify-between gap-2 border-b border-border py-1.5 last:border-b-0"
            >
              <span className="min-w-0">
                <span className="block truncate text-foreground">
                  {ts.kinds[e.kind]}
                </span>
                <span className="block truncate text-xs text-muted">
                  {new Date(e.created_at).toLocaleDateString()}
                  {e.reason ? ` · ${e.reason}` : ''}
                </span>
              </span>
              <span
                className={`shrink-0 font-mono ${
                  e.amount_delta >= 0 ? 'text-success' : 'text-danger'
                }`}
              >
                {e.amount_delta >= 0 ? '+' : '−'}
                {formatMoney(Math.abs(e.amount_delta))}
              </span>
            </li>
          ))}
        </ul>
      )}

      {!enabled && balance > 0 ? (
        <p className="mt-3 text-xs text-muted">
          <Link href="/settings/store-credit" className="text-blue underline">
            {ts.enableHint}
          </Link>
        </p>
      ) : null}

      <AdjustStoreCreditModal
        open={showAdjust}
        onClose={() => setShowAdjust(false)}
        customerId={customerId}
        customerName={customerName}
        balance={balance}
      />
    </section>
  )
}
