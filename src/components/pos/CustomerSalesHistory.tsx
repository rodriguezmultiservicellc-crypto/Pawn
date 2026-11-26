'use client'

import { useEffect, useState } from 'react'
import { Receipt } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { formatMoney, shortDate } from '@/lib/format/money'
import { CustomerHistoryCard } from '@/components/customers/CustomerHistoryCard'
import type { CustomerSalesHistory as History } from '@/lib/pos/customer-history'
import { loadCustomerSalesHistoryAction } from '@/app/(staff)/pos/sales/new/history-actions'

const SALE_TONE: Record<string, string> = {
  open: 'border-info/30 bg-info/5 text-info',
  completed: 'border-success/30 bg-success/5 text-success',
  partial_returned: 'border-warning/30 bg-warning/5 text-warning',
  fully_returned: 'border-warning/30 bg-warning/5 text-warning',
  voided: 'border-border bg-background text-muted',
}
const LAYAWAY_TONE: Record<string, string> = {
  active: 'border-info/30 bg-info/5 text-info',
  completed: 'border-success/30 bg-success/5 text-success',
  cancelled: 'border-border bg-background text-muted',
  defaulted: 'border-danger/30 bg-danger/5 text-danger',
}

/** The picked customer's purchases and layaways, on New sale. */
export function CustomerSalesHistory({ customerId }: { customerId: string }) {
  const { t } = useI18n()
  const h = t.pos.customerHistory
  const sb = t.pos.statusBadges
  const [loaded, setLoaded] = useState<{ customerId: string; history: History | null; failed: boolean } | null>(null)

  useEffect(() => {
    let live = true
    loadCustomerSalesHistoryAction(customerId)
      .then((res) => {
        if (live) setLoaded({ customerId, history: res.ok ? res.history : null, failed: !res.ok })
      })
      .catch(() => {
        if (live) setLoaded({ customerId, history: null, failed: true })
      })
    return () => {
      live = false
    }
  }, [customerId])

  // A result for an earlier customer is not shown while the new one loads.
  const cur = loaded?.customerId === customerId ? loaded : null
  const history = cur?.history ?? null
  const state = cur?.failed
    ? 'failed'
    : !history
      ? 'loading'
      : history.recent.length === 0
        ? 'empty'
        : 'ready'

  return (
    <CustomerHistoryCard
      state={state}
      icon={<Receipt size={18} weight="regular" />}
      title={h.title}
      text={h}
      stats={
        history
          ? [
              { label: h.purchases, value: String(history.purchases) },
              { label: h.spent, value: formatMoney(history.spent) },
              ...(history.returns > 0
                ? [{ label: h.returns, value: String(history.returns), tone: 'text-warning' }]
                : []),
              ...(history.layaways_active > 0
                ? [
                    { label: h.layaways, value: String(history.layaways_active) },
                    { label: h.layawayOwed, value: formatMoney(history.layaway_owed), tone: 'text-warning' },
                  ]
                : []),
            ]
          : []
      }
      since={history?.first_date ? h.since.replace('{date}', shortDate(history.first_date)) : null}
      rows={(history?.recent ?? []).map((r) => ({
        id: r.id,
        href: r.layaway_id ? `/pos/layaways/${r.layaway_id}` : `/pos/sales/${r.id}`,
        number: r.sale_number,
        date: shortDate(r.date),
        badge:
          r.kind === 'layaway'
            ? {
                text: h.layawayBadge.replace(
                  '{status}',
                  (sb.layaway as Record<string, string>)[r.status] ?? r.status,
                ),
                className: LAYAWAY_TONE[r.status] ?? LAYAWAY_TONE.active,
              }
            : {
                text: (sb.sale as Record<string, string>)[r.status] ?? r.status,
                className: SALE_TONE[r.status] ?? SALE_TONE.open,
              },
        amount: formatMoney(r.total),
        detail: r.items.join(' · '),
      }))}
      allHref={`/pos/sales?customer=${customerId}`}
      allLabel={h.all}
    />
  )
}
