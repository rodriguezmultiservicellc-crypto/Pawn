'use client'

import Link from 'next/link'
import { Warning } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import type { PledgeAlert } from '@/lib/counts/server'

/**
 * Manager alert: pledged items a vault audit could not find and nobody has
 * resolved yet. Shown on the dashboard and the counts page until resolved.
 */
export function PledgeAlertBanner({ alert }: { alert: PledgeAlert }) {
  const { t } = useI18n()
  if (alert.count <= 0) return null
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
      <Warning size={18} weight="fill" />
      <span className="flex-1">{t.counts.alert.pledges.replace('{n}', String(alert.count))}</span>
      <Link
        href={alert.sessionId ? `/inventory/counts/${alert.sessionId}` : '/inventory/counts'}
        className="font-semibold underline-offset-2 hover:underline"
      >
        {t.counts.alert.review}
      </Link>
    </div>
  )
}
