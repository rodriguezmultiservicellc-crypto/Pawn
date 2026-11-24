'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Warning } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { loadPledgorGapsAction } from '@/app/(staff)/customers/pledgor-actions'
import type { PledgorField } from '@/lib/customers/pledgor-record'

/**
 * Under the customer picker on New pawn / New buy: names what the picked
 * customer's record still lacks (FL 539.001(8)(b)) and links to it. Checks
 * again when the clerk comes back to this tab, so fixing the record in
 * another tab clears it. The save is refused on the server either way.
 */
export function PledgorRecordBanner({ customerId }: { customerId: string | null }) {
  const { t } = useI18n()
  const [result, setResult] = useState<{ id: string; missing: PledgorField[] } | null>(null)

  useEffect(() => {
    if (!customerId) return
    let live = true
    const check = () => {
      void loadPledgorGapsAction(customerId).then((r) => {
        if (live && r.ok) setResult({ id: customerId, missing: r.missing })
      })
    }
    check()
    window.addEventListener('focus', check)
    return () => {
      live = false
      window.removeEventListener('focus', check)
    }
  }, [customerId])

  if (!customerId || !result || result.id !== customerId || result.missing.length === 0) return null

  return (
    <div
      role="alert"
      className="flex flex-wrap items-start gap-3 rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger"
    >
      <Warning size={18} weight="fill" className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{t.pledgorRecord.bannerTitle}</p>
        <p>
          {t.pledgorRecord.bannerBody.replace(
            '{fields}',
            result.missing.map((f) => t.pledgorRecord.fields[f]).join(', '),
          )}
        </p>
      </div>
      <Link
        href={`/customers/${customerId}`}
        target="_blank"
        className="shrink-0 rounded-xl border border-danger/40 bg-card px-3 py-1.5 font-semibold text-danger hover:bg-background"
      >
        {t.pledgorRecord.completeRecord}
      </Link>
    </div>
  )
}
