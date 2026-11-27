'use client'

import { useI18n } from '@/lib/i18n/context'

/** Which LeadsOnline web service a ticket went to (patches/0123). */
export function EnvBadge({ env }: { env: 'sandbox' | 'production' }) {
  const { t } = useI18n()
  return env === 'production' ? (
    <span className="inline-flex rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-warning">
      {t.leadsonline.envProduction}
    </span>
  ) : (
    <span className="inline-flex rounded-full bg-info/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-info">
      {t.leadsonline.envSandbox}
    </span>
  )
}
