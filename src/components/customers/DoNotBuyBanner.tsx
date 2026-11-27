'use client'

import { useEffect, useState } from 'react'
import { CheckCircle, Prohibit, Warning } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { checkCustomerDoNotBuyAction } from '@/app/(staff)/customers/do-not-buy-actions'
import type { DoNotBuyResult } from '@/lib/leadsonline/do-not-buy'

/**
 * Under the customer picker on New pawn / Purchase / Buy outright: the
 * LeadsOnline Do Not Buy check for the picked customer, run as soon as they
 * are picked. Nothing shows for a shop without the LeadsOnline login. The
 * server checks again when the ticket is written and refuses a match.
 */
export function DoNotBuyBanner({ customerId }: { customerId: string | null }) {
  const { t } = useI18n()
  const td = t.leadsonline.intake
  const [result, setResult] = useState<{ id: string; r: DoNotBuyResult } | null>(null)

  useEffect(() => {
    if (!customerId) return
    let live = true
    void checkCustomerDoNotBuyAction(customerId).then(
      (r) => live && setResult({ id: customerId, r }),
      () => live && setResult({ id: customerId, r: { status: 'unavailable', message: 'network' } }),
    )
    return () => {
      live = false
    }
  }, [customerId])

  if (!customerId) return null
  const r = result?.id === customerId ? result.r : null

  if (r == null) {
    return <p className="text-xs text-text-secondary">{td.checking}</p>
  }
  if (r.status === 'off') return null
  if (r.status === 'clear') {
    return (
      <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-success">
        <CheckCircle size={14} weight="bold" />
        {td.clear}
      </p>
    )
  }
  if (r.status === 'unavailable') {
    return (
      <p className="inline-flex items-start gap-1.5 text-xs font-semibold text-warning">
        <Warning size={14} weight="bold" className="mt-0.5 shrink-0" />
        {r.message === 'not_enough' ? td.notEnough : td.unavailable}
      </p>
    )
  }
  return (
    <div role="alert" className="flex items-start gap-3 rounded-xl border border-danger/40 bg-danger/5 px-4 py-3 text-sm text-danger">
      <Prohibit size={18} weight="bold" className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-bold">{td.matchTitle}</p>
        <p className="text-foreground">{td.matchBody}</p>
        <ul className="mt-1 space-y-0.5 text-foreground">
          {r.hits.map((h, i) => (
            <li key={i}>
              <span className="font-semibold">{h.name}</span>
              {h.dob ? ` · ${h.dob}` : ''}
              {h.ID ? ` · ${h.ID}` : ''}
              {h.agency ? ` · ${t.leadsonline.dnbAgency} ${h.agency}` : ''}
              {h.contactName || h.contactNumber
                ? ` · ${t.leadsonline.dnbContact} ${[h.contactName, h.contactNumber].filter(Boolean).join(' ')}`
                : ''}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
