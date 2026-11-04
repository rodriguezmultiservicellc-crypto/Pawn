'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ChatText,
  CurrencyDollar,
  Phone,
  Receipt,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { formatMoney, shortDate } from '@/lib/format/money'
import { SendReminderDialog } from '@/components/comms/SendReminderDialog'
import { manualSendAction } from '@/app/(staff)/settings/communications/actions'
import {
  AGING_BUCKETS,
  type AgingBucket,
  type CollectionKind,
  type CollectionRow,
} from '@/lib/collections/aging'
import type { CollectionsData } from '@/lib/collections/load'
import type { MessageKind } from '@/types/database-aliases'

const BUCKET_STYLE: Record<AgingBucket, string> = {
  on_time: 'border-success/30 bg-success/10 text-success',
  slight: 'border-warning/30 bg-warning/10 text-warning',
  very: 'border-warning/40 bg-warning/20 text-warning',
  urgent: 'border-danger/30 bg-danger/10 text-danger',
}

const REMINDER_KINDS: Record<CollectionKind, { allowed: MessageKind[]; def: MessageKind }> = {
  loan: { allowed: ['loan_overdue_t1', 'loan_overdue_t7', 'loan_due_today', 'custom'], def: 'loan_overdue_t1' },
  layaway: { allowed: ['layaway_payment_due', 'layaway_overdue', 'custom'], def: 'layaway_overdue' },
  repair: { allowed: ['repair_pickup_reminder', 'custom'], def: 'repair_pickup_reminder' },
}

export default function CollectionsContent({ data, today }: { data: CollectionsData; today: string }) {
  const { t } = useI18n()
  const c = t.collections
  const [bucket, setBucket] = useState<AgingBucket | ''>('')
  const [kind, setKind] = useState<CollectionKind | ''>('')
  const [reminderFor, setReminderFor] = useState<CollectionRow | null>(null)

  const rows = useMemo(
    () => data.rows.filter((r) => (!bucket || r.bucket === bucket) && (!kind || r.kind === kind)),
    [data.rows, bucket, kind],
  )
  const k = data.kpis

  const bucketLabel = (b: AgingBucket) =>
    c.buckets[b]
      .replace('{slight}', String(data.config.slightDays))
      .replace('{slightPlus}', String(data.config.slightDays + 1))
      .replace('{very}', String(data.config.veryDays))
      .replace('{veryPlus}', String(data.config.veryDays + 1))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display flex items-center gap-2 text-2xl font-bold">
            <CurrencyDollar size={22} weight="bold" />
            {c.title}
          </h1>
          <p className="text-sm text-muted">{c.subtitle.replace('{date}', shortDate(today))}</p>
        </div>
        <Link href="/settings/general" className="text-xs text-muted hover:text-foreground hover:underline">
          {c.configureBuckets}
        </Link>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label={c.kpiTotalOwed} value={formatMoney(k.totalOwed)} sub={c.kpiRows.replace('{n}', String(k.rowCount))} big />
        <Kpi
          label={c.kpiOverdue}
          value={`${k.overduePct}%`}
          sub={`${formatMoney(k.overdueOwed)} · ${c.kpiRows.replace('{n}', String(k.overdueCount))}`}
          tone={k.overduePct > 50 ? 'danger' : k.overduePct > 20 ? 'warning' : 'success'}
        />
        <Kpi
          label={c.kpiAvgDays}
          value={k.avgDaysToCollect == null ? '—' : `${k.avgDaysToCollect} d`}
          sub={c.kpiAvgDaysHelp}
        />
        <Kpi
          label={c.kpiPromised}
          value={k.promisedKeptPct == null ? '—' : `${k.promisedKeptPct}%`}
          sub={c.kpiPromisedHelp.replace('{kept}', String(k.promisedKept)).replace('{due}', String(k.promisedDue))}
        />
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="text-[10px] uppercase tracking-wide text-muted">{c.kpiTop}</div>
          <ol className="mt-1 space-y-0.5 text-xs">
            {k.topCustomers.length === 0 ? <li className="text-muted">—</li> : null}
            {k.topCustomers.map((tc, i) => (
              <li key={`${tc.customerId ?? tc.customerName}-${i}`} className="flex justify-between gap-2">
                {tc.customerId ? (
                  <Link href={`/customers/${tc.customerId}`} className="truncate text-foreground hover:underline">
                    {tc.customerName}
                  </Link>
                ) : (
                  <span className="truncate text-foreground">{tc.customerName}</span>
                )}
                <span className="shrink-0 font-mono tabular-nums text-foreground">{formatMoney(tc.balance)}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      {/* Bucket strip */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {AGING_BUCKETS.map((b) => (
          <button
            key={b}
            type="button"
            onClick={() => setBucket(bucket === b ? '' : b)}
            aria-pressed={bucket === b}
            className={`rounded-xl border p-3 text-left transition-colors ${BUCKET_STYLE[b]} ${
              bucket === b ? 'ring-2 ring-navy' : ''
            }`}
          >
            <div className="text-[10px] font-bold uppercase tracking-wide">{bucketLabel(b)}</div>
            <div className="mt-1 font-mono text-lg font-bold tabular-nums">{formatMoney(k.byBucket[b].balance)}</div>
            <div className="text-[11px] opacity-80">{c.kpiRows.replace('{n}', String(k.byBucket[b].count))}</div>
          </button>
        ))}
      </div>

      {/* Kind filter */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-xs uppercase tracking-wide text-muted">{c.source}</span>
        {(['', 'loan', 'layaway', 'repair'] as const).map((kd) => (
          <button
            key={kd || 'all'}
            type="button"
            onClick={() => setKind(kd)}
            aria-pressed={kind === kd}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              kind === kd ? 'border-navy bg-navy text-white' : 'border-border bg-card text-foreground hover:bg-background'
            }`}
          >
            {kd === '' ? t.common.all : c.kinds[kd]}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted">{c.kpiRows.replace('{n}', String(rows.length))}</span>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center text-sm text-muted">
          {data.rows.length === 0 ? c.emptyAll : c.emptyFilter}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2 font-semibold">{c.colCustomer}</th>
                <th className="px-3 py-2 font-semibold">{c.colSource}</th>
                <th className="px-3 py-2 font-semibold">{c.colDue}</th>
                <th className="px-3 py-2 text-right font-semibold">{c.colLate}</th>
                <th className="px-3 py-2 text-right font-semibold">{c.colBalance}</th>
                <th className="px-3 py-2 text-right font-semibold">{t.common.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={`${r.kind}-${r.id}`} className="align-top">
                  <td className="px-3 py-2">
                    {r.customerId ? (
                      <Link href={`/customers/${r.customerId}`} className="font-medium text-foreground hover:underline">
                        {r.customerName}
                      </Link>
                    ) : (
                      <span className="font-medium text-foreground">{r.customerName}</span>
                    )}
                    {r.phone ? <div className="font-mono text-xs text-muted">{r.phone}</div> : null}
                  </td>
                  <td className="px-3 py-2">
                    <Link href={r.href} className="text-foreground hover:underline">
                      {c.kinds[r.kind]} <span className="font-mono text-xs text-muted">{r.reference}</span>
                    </Link>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-foreground">{r.dueDate ? shortDate(r.dueDate) : '—'}</td>
                  <td className="px-3 py-2 text-right">
                    <span className={`inline-block rounded-full border px-2 py-0.5 font-mono text-[11px] ${BUCKET_STYLE[r.bucket]}`}>
                      {r.daysLate > 0 ? c.daysLate.replace('{n}', String(r.daysLate)) : c.onTime}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums text-foreground">
                    {formatMoney(r.balance)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      {r.phone ? (
                        <a
                          href={`tel:${r.phone.replace(/[^\d+]/g, '')}`}
                          className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground hover:bg-background"
                          title={c.call}
                        >
                          <Phone size={12} weight="bold" />
                          {c.call}
                        </a>
                      ) : null}
                      {r.customerId ? (
                        <button
                          type="button"
                          onClick={() => setReminderFor(r)}
                          className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground hover:bg-background"
                          title={c.text}
                        >
                          <ChatText size={12} weight="bold" />
                          {c.text}
                        </button>
                      ) : null}
                      <Link
                        href={r.href}
                        className="inline-flex items-center gap-1 rounded-md bg-gold px-2 py-1 text-xs font-medium text-navy hover:bg-gold-2"
                        title={c.recordPayment}
                      >
                        <Receipt size={12} weight="bold" />
                        {c.recordPayment}
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-muted">{c.footnote.replace('{days}', '90')}</p>

      {reminderFor && reminderFor.customerId ? (
        <SendReminderDialog
          customerId={reminderFor.customerId}
          customerName={reminderFor.customerName}
          allowedKinds={REMINDER_KINDS[reminderFor.kind].allowed}
          defaultKind={REMINDER_KINDS[reminderFor.kind].def}
          related={
            reminderFor.kind === 'loan'
              ? { loanId: reminderFor.id }
              : reminderFor.kind === 'layaway'
                ? { layawayId: reminderFor.id }
                : { repairTicketId: reminderFor.id }
          }
          onClose={() => setReminderFor(null)}
          action={manualSendAction}
        />
      ) : null}
    </div>
  )
}

function Kpi({
  label,
  value,
  sub,
  big,
  tone,
}: {
  label: string
  value: string
  sub?: string
  big?: boolean
  tone?: 'success' | 'warning' | 'danger'
}) {
  const toneClass =
    tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : tone === 'success' ? 'text-success' : 'text-foreground'
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 font-mono font-bold tabular-nums ${big ? 'text-2xl' : 'text-xl'} ${toneClass}`}>{value}</div>
      {sub ? <div className="mt-0.5 text-[11px] text-muted">{sub}</div> : null}
    </div>
  )
}
