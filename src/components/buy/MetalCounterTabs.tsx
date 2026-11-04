'use client'

import Link from 'next/link'
import { ArrowLeft, Coins, HandCoins } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'

/**
 * Buy ⇄ Sell switch at the top of the metal counter (brief Phase 3). Both
 * surfaces are real routes — /buy/new and /buy/sell — so the browser back
 * button and the sidebar keep working; the tabs are just links.
 */
export default function MetalCounterTabs({
  active,
  showBuy = true,
  showSell = true,
  right,
}: {
  active: 'buy' | 'sell'
  showBuy?: boolean
  showSell?: boolean
  right?: React.ReactNode
}) {
  const { t } = useI18n()
  const base =
    'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors'
  const on = 'bg-navy text-white'
  const off = 'text-foreground hover:bg-background'

  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <Link
          href="/inventory"
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft size={14} weight="bold" />
          {t.inventory.backToList}
        </Link>
        <nav
          aria-label={t.buy.counter.title}
          className="inline-flex items-center gap-1 rounded-xl border border-border bg-card p-1"
        >
          {showBuy ? (
            <Link
              href="/buy/new"
              aria-current={active === 'buy' ? 'page' : undefined}
              className={`${base} ${active === 'buy' ? on : off}`}
            >
              <HandCoins size={16} weight="bold" />
              {t.buy.counter.tabBuy}
            </Link>
          ) : null}
          {showSell ? (
            <Link
              href="/buy/sell"
              aria-current={active === 'sell' ? 'page' : undefined}
              className={`${base} ${active === 'sell' ? on : off}`}
            >
              <Coins size={16} weight="bold" />
              {t.buy.counter.tabSell}
            </Link>
          ) : null}
        </nav>
      </div>
      {right ? <div className="text-xs text-muted">{right}</div> : null}
    </header>
  )
}
