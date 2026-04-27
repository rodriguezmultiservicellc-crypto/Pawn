'use client'

import { useI18n } from '@/lib/i18n/context'
import type { ServiceType } from '@/types/database-aliases'

const TONE: Record<ServiceType, { dot: string; text: string; bg: string }> = {
  repair: { dot: 'bg-rausch', text: 'text-rausch', bg: 'bg-rausch/5' },
  stone_setting: {
    dot: 'bg-warning',
    text: 'text-warning',
    bg: 'bg-warning/5',
  },
  sizing: { dot: 'bg-ash', text: 'text-ash', bg: 'bg-cloud' },
  restring: { dot: 'bg-cloud', text: 'text-ink', bg: 'bg-cloud/60' },
  plating: { dot: 'bg-success', text: 'text-success', bg: 'bg-success/5' },
  engraving: { dot: 'bg-ink', text: 'text-ink', bg: 'bg-cloud' },
  custom: { dot: 'bg-ink', text: 'text-ink', bg: 'bg-cloud' },
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
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-hairline px-2 py-0.5 text-xs font-medium ${tone.bg} ${tone.text}`}
    >
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${tone.dot}`} />
      {map[type]}
    </span>
  )
}
