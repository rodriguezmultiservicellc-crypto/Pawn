'use client'

import { useI18n } from '@/lib/i18n/context'
import type { RepairStatus } from '@/types/database-aliases'

const TONE: Record<RepairStatus, { bg: string; text: string }> = {
  intake: { bg: 'bg-background border-border', text: 'text-muted' },
  quoted: { bg: 'bg-background border-border', text: 'text-foreground' },
  awaiting_approval: {
    bg: 'bg-warning/5 border-warning/30',
    text: 'text-warning',
  },
  // Routed to a tech but not yet claimed — neutral cool tone signaling
  // queued work.
  assigned: { bg: 'bg-gold/5 border-gold/20', text: 'text-gold-2' },
  in_progress: { bg: 'bg-gold/5 border-gold/30', text: 'text-gold' },
  needs_parts: { bg: 'bg-warning/10 border-warning/40', text: 'text-warning' },
  // Final QA pass — uses the same warm tone as ready since it's the
  // last lap, but slightly muted.
  tech_qa: { bg: 'bg-success/5 border-success/20', text: 'text-success' },
  ready: { bg: 'bg-success/10 border-success/30', text: 'text-success' },
  picked_up: { bg: 'bg-success/5 border-success/20', text: 'text-success' },
  abandoned: { bg: 'bg-danger/5 border-danger/30', text: 'text-danger' },
  voided: { bg: 'bg-danger/5 border-danger/30', text: 'text-danger' },
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
