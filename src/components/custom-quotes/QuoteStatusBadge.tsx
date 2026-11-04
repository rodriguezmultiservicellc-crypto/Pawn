'use client'

import { useI18n } from '@/lib/i18n/context'
import type { CustomQuoteStatus } from '@/types/database-aliases'

// Semantic colors only where the status IS the message (DESIGN-lunaazul §2):
// accepted/converted = success, expired = warning, declined/voided = danger.
const TONE: Record<CustomQuoteStatus, string> = {
  draft: 'border-border bg-background text-foreground',
  sent: 'border-info/30 bg-info/5 text-info',
  accepted: 'border-success/30 bg-success/5 text-success',
  converted: 'border-success/30 bg-success/5 text-success',
  expired: 'border-warning/30 bg-warning/5 text-warning',
  declined: 'border-danger/30 bg-danger/5 text-danger',
  voided: 'border-danger/30 bg-danger/5 text-danger',
}

export function QuoteStatusBadge({ status }: { status: CustomQuoteStatus }) {
  const { t } = useI18n()
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${TONE[status]}`}>
      {t.quotes.status[status]}
    </span>
  )
}
