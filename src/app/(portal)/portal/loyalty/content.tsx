// src/app/(portal)/portal/loyalty/content.tsx
'use client'

import { useState } from 'react'
import { Trophy, Copy, Check } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'

type Kind =
  | 'earn_sale'
  | 'earn_loan_interest'
  | 'earn_referral_bonus'
  | 'redeem_pos'
  | 'redeem_undo'
  | 'earn_clawback'
  | 'adjust_manual'

export default function LoyaltyPortalContent({
  customer,
  tenantDba,
  shareUrl,
  settings,
  activity,
  friendsReferred,
}: {
  customer: { firstName: string; balance: number; referralCode: string }
  tenantDba: string
  shareUrl: string
  settings: {
    earnRetail: number
    earnLoan: number
    redemptionRate: number
    referralBonus: number
  }
  activity: {
    id: string
    kind: Kind
    points_delta: number
    reason: string | null
    created_at: string
  }[]
  friendsReferred: number
}) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)

  const equiv = customer.balance / settings.redemptionRate
  const code = customer.referralCode

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* noop */
    }
  }

  const shareText = t.loyalty.shareTextTemplate
    .replace('{code}', code)
    .replace('{tenant}', tenantDba)
    .replace('{url}', shareUrl)

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <header>
        <div className="flex items-center gap-2 text-rausch">
          <Trophy size={22} weight="fill" />
          <h1 className="text-2xl font-semibold text-ink">{t.loyalty.title}</h1>
        </div>
      </header>

      {/* Hero */}
      <section className="rounded-lg border border-hairline bg-canvas p-6">
        <p className="mb-1 text-sm uppercase tracking-wide text-ash">
          {t.loyalty.yourPoints}
        </p>
        <div className="font-mono text-5xl font-bold text-ink">
          {customer.balance.toLocaleString()}
        </div>
        <p className="mt-2 text-sm text-ash">
          {t.loyalty.storeCreditEquiv
            .replace('{value}', equiv.toFixed(2))
            .replace('{tenant}', tenantDba)}
        </p>
        <p className="mt-3 text-sm text-ink">{t.loyalty.heroSubtitle}</p>
      </section>

      {/* Earn rules */}
      <section className="rounded-lg border border-hairline bg-canvas p-6">
        <h2 className="mb-3 text-base font-semibold text-ink">
          {t.loyalty.howYouEarn}
        </h2>
        <ul className="space-y-1 text-sm text-ink">
          <li>
            • {t.loyalty.earnRetail.replace('{rate}', String(settings.earnRetail))}
          </li>
          <li>
            •{' '}
            {t.loyalty.earnLoanInterest.replace('{rate}', String(settings.earnLoan))}
          </li>
          <li>
            •{' '}
            {t.loyalty.earnReferral.replace(
              '{bonus}',
              String(settings.referralBonus),
            )}
          </li>
        </ul>
        <h2 className="mb-2 mt-4 text-base font-semibold text-ink">
          {t.loyalty.howYouRedeem}
        </h2>
        <p className="text-sm text-ink">{t.loyalty.redemptionInstructions}</p>
      </section>

      {/* Refer a friend */}
      <section className="rounded-lg border border-hairline bg-canvas p-6">
        <h2 className="mb-3 text-base font-semibold text-ink">
          {t.loyalty.referAFriend}
        </h2>
        <div className="mb-3 flex items-center gap-2">
          <span className="text-sm text-ash">{t.loyalty.yourCode}:</span>
          <code className="rounded bg-cloud px-3 py-1.5 font-mono text-base text-ink">
            {code}
          </code>
          <button
            type="button"
            onClick={copy}
            className="rounded p-2 text-ash hover:bg-cloud hover:text-ink"
            title={t.loyalty.copyCode}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </button>
          {copied && (
            <span className="text-xs text-success">{t.loyalty.copied}</span>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <a
            href={`sms:?body=${encodeURIComponent(shareText)}`}
            className="rounded-md border border-hairline bg-canvas px-3 py-1.5 text-sm text-ink hover:bg-cloud"
          >
            {t.loyalty.shareSms}
          </a>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
            target="_blank"
            rel="noreferrer noopener"
            className="rounded-md border border-hairline bg-canvas px-3 py-1.5 text-sm text-ink hover:bg-cloud"
          >
            {t.loyalty.shareWhatsapp}
          </a>
          <a
            href={`mailto:?subject=${encodeURIComponent(tenantDba)}&body=${encodeURIComponent(shareText)}`}
            className="rounded-md border border-hairline bg-canvas px-3 py-1.5 text-sm text-ink hover:bg-cloud"
          >
            {t.loyalty.shareEmail}
          </a>
        </div>

        <p className="mt-3 text-sm text-ash">
          {friendsReferred > 0
            ? t.loyalty.friendsReferred.replace('{count}', String(friendsReferred))
            : t.loyalty.friendsReferredZero}
        </p>
      </section>

      {/* Activity */}
      <section className="rounded-lg border border-hairline bg-canvas p-6">
        <h2 className="mb-3 text-base font-semibold text-ink">
          {t.loyalty.activity}
        </h2>
        {activity.length === 0 ? (
          <p className="text-sm text-ash">{t.loyalty.emptyActivity}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {activity.map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between gap-2 border-b border-hairline py-1.5 last:border-b-0"
              >
                <span className="text-ink">{t.loyalty.kinds[e.kind]}</span>
                <span
                  className={`font-mono ${
                    e.points_delta >= 0 ? 'text-success' : 'text-error'
                  }`}
                >
                  {e.points_delta >= 0 ? '+' : ''}
                  {e.points_delta.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
