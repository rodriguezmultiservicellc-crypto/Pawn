'use client'

import Link from 'next/link'
import { Warning } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { shortDateTime } from '@/lib/format/money'
import {
  staleAgeLabelHours,
  type SpotFreshness,
} from '@/lib/spot-prices/staleness'

/**
 * Red banner shown on Spot Prices, Buy Outright, New Pawn Ticket and the
 * Loan Calculator when the newest spot price is older than the threshold
 * (or there is none). Renders nothing while the feed is fresh.
 *
 * `onDark` flips the palette for the navy intake rails. `showOpenLink`
 * is off on the Spot Prices page itself, where "Refresh now" sits beside it.
 */
export default function StalePriceBanner({
  freshness,
  showOpenLink = true,
  onDark = false,
}: {
  freshness: SpotFreshness
  showOpenLink?: boolean
  onDark?: boolean
}) {
  const { t } = useI18n()
  if (!freshness.stale) return null

  const hours = staleAgeLabelHours(freshness.ageHours)
  const body =
    freshness.newestFetchedAt && hours != null
      ? t.spotPrices.staleBody
          .replace('{hours}', String(hours))
          .replace('{when}', shortDateTime(freshness.newestFetchedAt))
      : t.spotPrices.staleBodyNoData

  return (
    <div
      role="alert"
      className={
        onDark
          ? 'rounded-xl border border-danger/50 bg-danger/20 p-3 text-white'
          : 'rounded-xl border border-danger/40 bg-danger/10 p-3 text-foreground'
      }
    >
      <div className="flex items-start gap-2">
        <Warning size={18} weight="fill" className="mt-0.5 shrink-0 text-danger" />
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-bold text-danger">{t.spotPrices.staleTitle}</div>
          <p className="mt-0.5">{body}</p>
          <p className={onDark ? 'mt-1 text-xs text-white/70' : 'mt-1 text-xs text-text-secondary'}>
            {t.spotPrices.staleRefreshHint}
          </p>
          {showOpenLink ? (
            <Link
              href="/inventory/spot-prices"
              className={
                onDark
                  ? 'mt-2 inline-block text-xs font-bold text-gold hover:underline'
                  : 'mt-2 inline-block text-xs font-bold text-blue hover:underline'
              }
            >
              {t.spotPrices.staleOpen} →
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/**
 * The manager-confirmation block that accompanies the banner on the two
 * issuing forms. Posts `stale_spot_ack=on` when ticked; the server action
 * re-checks both the staleness and the role.
 */
export function StaleSpotConfirm({
  freshness,
  canConfirm,
  checked,
  onChange,
  onDark = false,
}: {
  freshness: SpotFreshness
  canConfirm: boolean
  checked: boolean
  onChange: (next: boolean) => void
  onDark?: boolean
}) {
  const { t } = useI18n()
  if (!freshness.stale) return null

  return (
    <div
      className={
        onDark
          ? 'rounded-xl border border-danger/50 bg-danger/15 p-3 text-white'
          : 'rounded-xl border border-danger/40 bg-danger/5 p-3 text-foreground'
      }
    >
      <div className="text-sm font-bold text-danger">
        {t.spotPrices.staleConfirmTitle}
      </div>
      {canConfirm ? (
        <>
          <p className={onDark ? 'mt-1 text-xs text-white/80' : 'mt-1 text-xs text-text-secondary'}>
            {t.spotPrices.staleConfirmBody}
          </p>
          <label className="mt-2 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="stale_spot_ack"
              checked={checked}
              onChange={(e) => onChange(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-border accent-gold"
            />
            <span className="font-semibold">{t.spotPrices.staleConfirmLabel}</span>
          </label>
        </>
      ) : (
        <p className={onDark ? 'mt-1 text-xs text-white/80' : 'mt-1 text-xs text-text-secondary'}>
          {t.spotPrices.staleManagerOnly}
        </p>
      )}
    </div>
  )
}
