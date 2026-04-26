'use client'

import { useI18n } from '@/lib/i18n/context'

export default function DashboardContent() {
  const { t } = useI18n()
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t.dashboard.title}</h1>
      <p className="text-ash">{t.dashboard.placeholder}</p>
    </div>
  )
}
