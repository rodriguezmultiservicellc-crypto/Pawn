'use client'

import { useI18n } from '@/lib/i18n/context'
import type { RepairStatus } from '@/types/database-aliases'

const TONE: Record<RepairStatus, { bg: string; text: string }> = {
  intake: { bg: 'bg-cloud border-hairline', text: 'text-ash' },
  quoted: { bg: 'bg-cloud border-hairline', text: 'text-ink' },
  awaiting_approval: {
    bg: 'bg-warning/5 border-warning/30',
    text: 'text-warning',
  },
  in_progress: { bg: 'bg-rausch/5 border-rausch/30', text: 'text-rausch' },
  needs_parts: { bg: 'bg-warning/10 border-warning/40', text: 'text-warning' },
  ready: { bg: 'bg-success/10 border-success/30', text: 'text-success' },
  picked_up: { bg: 'bg-success/5 border-success/20', text: 'text-success' },
  abandoned: { bg: 'bg-error/5 border-error/30', text: 'text-error' },
  voided: { bg: 'bg-error/5 border-error/30', text: 'text-error' },
}

export function StatusBadge({ status }: { status: RepairStatus }) {
  const { t } = useI18n()
  const tone = TONE[status]
  const label = t.repair.statusBadges[status]
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tone.bg} ${tone.text}`}
    >
      {label}
    </span>
  )
}
