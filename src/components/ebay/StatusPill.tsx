'use client'

import { useI18n } from '@/lib/i18n/context'
import type { EbayListingStatus } from '@/types/database-aliases'

const PILL: Record<EbayListingStatus, { bg: string; text: string }> = {
  draft:      { bg: 'bg-cloud border-hairline', text: 'text-ash' },
  submitting: { bg: 'bg-warning/10 border-warning/30', text: 'text-warning' },
  active:     { bg: 'bg-success/10 border-success/30', text: 'text-success' },
  ended:      { bg: 'bg-cloud border-hairline', text: 'text-ash' },
  sold:       { bg: 'bg-success/10 border-success/30', text: 'text-success' },
  error:      { bg: 'bg-error/10 border-error/30', text: 'text-error' },
}

export function EbayStatusPill({ status }: { status: EbayListingStatus }) {
  const { t } = useI18n()
  const cls = PILL[status]
  const label =
    t.ebay.statuses?.[status] ?? status.charAt(0).toUpperCase() + status.slice(1)
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cls.bg} ${cls.text}`}
    >
      {label}
    </span>
  )
}
