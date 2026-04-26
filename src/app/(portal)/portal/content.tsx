'use client'

import { useI18n } from '@/lib/i18n/context'

export default function PortalContent() {
  const { t } = useI18n()
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t.nav.portal}</h1>
      <p className="text-ash">
        {t.dashboard.placeholder}
      </p>
    </div>
  )
}
