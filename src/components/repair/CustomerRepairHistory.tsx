'use client'

import { useEffect, useState } from 'react'
import { Wrench } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { formatMoney, shortDate } from '@/lib/format/money'
import { CustomerHistoryCard } from '@/components/customers/CustomerHistoryCard'
import type { CustomerRepairHistory as History } from '@/lib/repair/customer-history'
import { loadCustomerRepairHistoryAction } from '@/app/(staff)/repair/new/history-actions'

const STATUS_TONE: Record<string, string> = {
  ready: 'border-success/30 bg-success/5 text-success',
  picked_up: 'border-success/30 bg-success/5 text-success',
  abandoned: 'border-danger/30 bg-danger/5 text-danger',
  voided: 'border-border bg-background text-muted',
}
/** Every status still in the shop (intake … tech_qa). */
const IN_SHOP_TONE = 'border-info/30 bg-info/5 text-info'

/** The picked customer's repairs, beside them on New repair ticket. */
export function CustomerRepairHistory({ customerId }: { customerId: string }) {
  const { t } = useI18n()
  const h = t.repair.new_.history
  const [loaded, setLoaded] = useState<{ customerId: string; history: History | null; failed: boolean } | null>(null)

  useEffect(() => {
    let live = true
    loadCustomerRepairHistoryAction(customerId)
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
      : history.total === 0 && history.voided === 0
        ? 'empty'
        : 'ready'

  return (
    <CustomerHistoryCard
      state={state}
      icon={<Wrench size={18} weight="regular" />}
      title={h.title}
      text={h}
      stats={
        history
          ? [
              { label: h.repairs, value: String(history.total) },
              { label: h.inShop, value: String(history.open) },
              { label: h.ready, value: String(history.ready), tone: history.ready > 0 ? 'text-success' : undefined },
              { label: h.pickedUp, value: String(history.picked_up), tone: 'text-success' },
              ...(history.abandoned > 0
                ? [{ label: h.abandoned, value: String(history.abandoned), tone: 'text-danger' }]
                : []),
              ...(history.open_balance > 0 ? [{ label: h.owed, value: formatMoney(history.open_balance) }] : []),
            ]
          : []
      }
      since={history?.first_date ? h.since.replace('{date}', shortDate(history.first_date)) : null}
      rows={(history?.recent ?? []).map((r) => ({
        id: r.id,
        href: `/repair/${r.id}`,
        number: r.ticket_number,
        date: shortDate(r.created_at),
        badge: {
          text: (t.repair.statusBadges as Record<string, string>)[r.status] ?? r.status,
          className: STATUS_TONE[r.status] ?? IN_SHOP_TONE,
        },
        amount: r.quote != null ? formatMoney(r.quote) : '—',
        detail: r.title,
      }))}
      allHref={`/repair?customer=${customerId}`}
      allLabel={history ? h.all.replace('{n}', String(history.total + history.voided)) : undefined}
    />
  )
}
