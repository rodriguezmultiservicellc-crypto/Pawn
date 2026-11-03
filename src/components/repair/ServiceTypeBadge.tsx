'use client'

import { useI18n } from '@/lib/i18n/context'
import type { Dictionary } from '@/lib/i18n/en'
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

/** Translated service-type name — shared by the badge, the stages editor
 *  and the public tracking page. */
export function serviceTypeLabel(t: Dictionary, type: ServiceType): string {
  const m = t.repair.serviceTypes
  const map: Record<ServiceType, string> = {
    repair: m.repair,
    stone_setting: m.stoneSetting,
    sizing: m.sizing,
    restring: m.restring,
    plating: m.plating,
    engraving: m.engraving,
    custom: m.custom,
  }
  return map[type]
}

export function ServiceTypeBadge({ type }: { type: ServiceType }) {
  const { t } = useI18n()
  const tone = TONE[type]
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2 py-0.5 text-xs font-semibold text-foreground">
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${tone.dot}`} />
      {serviceTypeLabel(t, type)}
    </span>
  )
}
