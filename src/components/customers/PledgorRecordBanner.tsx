'use client'

import { useEffect, useState } from 'react'
import { Warning } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { loadPledgorGapsAction } from '@/app/(staff)/customers/pledgor-actions'
import type { PledgorField, PledgorRecord } from '@/lib/customers/pledgor-record'
import { CompletePledgorDialog } from './CompletePledgorDialog'

/**
 * Under the customer picker on New pawn / New buy: names what the picked
 * customer's record still lacks (FL 539.001(8)(b)). "Complete customer
 * record" opens a popup with just those fields, so the clerk never leaves
 * the ticket (Eddy, 2026-11-25). Checks again when the clerk comes back to
 * this tab, so a fix made on the full record (the popup links to it) clears
 * it too. The save is refused on the server either way.
 */
export function PledgorRecordBanner({ customerId }: { customerId: string | null }) {
  const { t } = useI18n()
  const [result, setResult] = useState<{
    id: string
    missing: PledgorField[]
    record: PledgorRecord
  } | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!customerId) return
    let live = true
    const check = () => {
      void loadPledgorGapsAction(customerId).then((r) => {
        if (live && r.ok) setResult({ id: customerId, missing: r.missing, record: r.record })
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
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 rounded-xl border border-danger/40 bg-card px-3 py-1.5 font-semibold text-danger hover:bg-background"
      >
        {t.pledgorRecord.completeRecord}
      </button>
      {open ? (
        <CompletePledgorDialog
          key={result.missing.join(',')}
          customerId={customerId}
          missing={result.missing}
          record={result.record}
          onClose={() => setOpen(false)}
          onSaved={(missing) => {
            setOpen(false)
            // Re-read the record so the next popup starts from what was saved.
            void loadPledgorGapsAction(customerId).then((r) => {
              if (r.ok) setResult({ id: customerId, missing: r.missing, record: r.record })
              else setResult((s) => (s ? { ...s, missing } : s))
            })
          }}
        />
      ) : null}
    </div>
  )
}
