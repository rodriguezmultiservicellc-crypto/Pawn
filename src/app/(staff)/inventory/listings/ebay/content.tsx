'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useI18n } from '@/lib/i18n/context'
import { EbayStatusPill } from '@/components/ebay/StatusPill'
import type {
  EbayListingFormat,
  EbayListingStatus,
} from '@/types/database-aliases'

export type EbayListingListRow = {
  id: string
  ebay_sku: string | null
  ebay_listing_id: string | null
  title: string
  list_price: string
  currency: string
  format: EbayListingFormat
  status: EbayListingStatus
  view_count: number | null
  watcher_count: number | null
  last_synced_at: string | null
  inventory_item_id: string
}

const TABS: EbayListingStatus[] = ['draft', 'active', 'sold', 'ended', 'error']

export default function EbayListingsListContent({
  rows,
  status,
}: {
  rows: EbayListingListRow[]
  status: EbayListingStatus
}) {
  const { t } = useI18n()
  const router = useRouter()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t.ebay.listingsTitle}</h1>
          <p className="text-sm text-muted">{t.ebay.listingsSubtitle}</p>
        </div>
        <Link
          href="/settings/integrations/ebay"
          className="text-sm text-muted hover:text-foreground"
        >
          {t.ebay.openSettingsLink} →
        </Link>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((s) => {
          const active = s === status
          const label =
            t.ebay.statuses?.[s] ?? s.charAt(0).toUpperCase() + s.slice(1)
          return (
            <button
              key={s}
              type="button"
              onClick={() => router.push(`/inventory/listings/ebay?status=${s}`)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm ${
                active
                  ? 'border-gold font-medium text-foreground'
                  : 'border-transparent text-muted hover:text-foreground'
              }`}
            >
              {label}
            </button>
          )
        })}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-12 text-center">
          <p className="text-muted">{t.ebay.listingsEmpty}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">{t.ebay.sku}</th>
                <th className="px-4 py-3 font-medium">{t.ebay.titleColumn}</th>
                <th className="px-4 py-3 font-medium">{t.ebay.priceColumn}</th>
                <th className="px-4 py-3 font-medium">{t.ebay.format}</th>
                <th className="px-4 py-3 font-medium">{t.ebay.status}</th>
                <th className="px-4 py-3 font-medium">{t.ebay.views}</th>
                <th className="px-4 py-3 font-medium">{t.ebay.watchers}</th>
                <th className="px-4 py-3 font-medium">{t.ebay.lastSynced}</th>
                <th className="px-4 py-3 font-medium" aria-label="link" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const ebayUrl =
                  r.ebay_listing_id && !r.ebay_listing_id.startsWith('STUB-')
                    ? `https://www.ebay.com/itm/${r.ebay_listing_id}`
                    : null
                return (
                  <tr
                    key={r.id}
                    className="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-background"
                    onClick={() =>
                      router.push(`/inventory/${r.inventory_item_id}#ebay`)
                    }
                  >
                    <td className="px-4 py-3 font-mono text-xs text-foreground">
                      {r.ebay_sku ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-foreground">{r.title}</td>
                    <td className="px-4 py-3 font-mono text-xs text-foreground">
                      {fmtMoney(r.list_price, r.currency)}
                    </td>
                    <td className="px-4 py-3 text-foreground">
                      {r.format === 'AUCTION'
                        ? t.ebay.formatAuction
                        : t.ebay.formatFixed}
                    </td>
                    <td className="px-4 py-3">
                      <EbayStatusPill status={r.status} />
                    </td>
                    <td className="px-4 py-3 text-foreground">{r.view_count ?? '—'}</td>
                    <td className="px-4 py-3 text-foreground">
                      {r.watcher_count ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">
                      {r.last_synced_at
                        ? new Date(r.last_synced_at).toLocaleString()
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {ebayUrl ? (
                        <a
                          href={ebayUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="font-medium text-gold hover:underline"
                        >
                          {t.ebay.viewOnEbay} ↗
                        </a>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function fmtMoney(amt: string, currency: string): string {
  const n = parseFloat(amt)
  if (!isFinite(n)) return '—'
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: 2,
    }).format(n)
  } catch {
    return `${currency} ${n.toFixed(2)}`
  }
}
