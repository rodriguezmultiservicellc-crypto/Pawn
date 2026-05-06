'use client'

import { useI18n } from '@/lib/i18n/context'
import type { ServiceType } from '@/types/database-aliases'

// Category badges use neutral surface + a colored dot to distinguish.
// Status colors (success/warning/danger/info) are reserved for status, never
// category — DESIGN-lunaazul.md §2. Gold is the action color, never used here.
const TONE: Record<ServiceType, { dot: string }> = {
  repair: { dot: 'bg-navy' },
  stone_setting: { dot: 'bg-blue' },
  sizing: { dot: 'bg-muted' },
  restring: { dot: 'bg-muted' },
  plating: { dot: 'bg-blue' },
  engraving: { dot: 'bg-muted' },
  custom: { dot: 'bg-navy' },
}

export function ServiceTypeBadge({ type }: { type: ServiceType }) {
  const { t } = useI18n()
  const tone = TONE[type]
  const map: Record<ServiceType, string> = {
    repair: t.repair.serviceTypes.repair,
    stone_setting: t.repair.serviceTypes.stoneSetting,
    sizing: t.repair.serviceTypes.sizing,
    restring: t.repair.serviceTypes.restring,
    plating: t.repair.serviceTypes.plating,
    engraving: t.repair.serviceTypes.engraving,
    custom: t.repair.serviceTypes.custom,
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2 py-0.5 text-xs font-semibold text-foreground">
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${tone.dot}`} />
      {map[type]}
    </span>
  )
}
