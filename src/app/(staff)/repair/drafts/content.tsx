'use client'

import Link from 'next/link'
import { ArrowRight, DeviceMobile, FileDashed, Plus } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { deleteRepairDraftAction } from './actions'

export type RepairDraftRow = {
  id: string
  customerName: string
  customerPhone: string | null
  itemCount: number
  /** Sum of the items' prices; null when no item is priced yet. */
  total: number | null
  updatedAt: string
  /** Opened on another device by QR code. */
  onOtherDevice: boolean
}

export default function RepairDraftsContent({ rows }: { rows: RepairDraftRow[] }) {
  const { t } = useI18n()
  const td = t.repair.drafts

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">{td.title}</h1>
          <p className="mt-0.5 text-sm text-muted">{td.subtitle}</p>
        </div>
        <Link
          href="/repair/new"
          className="inline-flex items-center gap-1 rounded-xl bg-gold px-5 py-3 text-sm font-bold text-navy shadow-lg transition-all hover:-translate-y-0.5 hover:bg-gold-2"
        >
          <Plus size={16} weight="bold" />
          <span>{t.repair.new}</span>
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <FileDashed size={32} weight="light" className="mx-auto mb-3 text-muted" />
          <p className="text-muted">{td.empty}</p>
          <Link
            href="/repair"
            className="mt-3 inline-block text-sm font-semibold text-blue hover:underline"
          >
            {td.backToRepairs}
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3 font-bold">{td.customer}</th>
                <th className="px-4 py-3 font-bold">{td.items}</th>
                <th className="px-4 py-3 font-bold">{td.total}</th>
                <th className="px-4 py-3 font-bold">{td.savedAt}</th>
                <th className="px-4 py-3 text-right font-bold">{t.common.actions}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-border transition-colors last:border-b-0 hover:bg-background"
                >
                  <td className="px-4 py-3">
                    <div className="font-semibold text-foreground">{r.customerName}</div>
                    {r.customerPhone ? (
                      <div className="text-xs text-muted">{r.customerPhone}</div>
                    ) : null}
                    {r.onOtherDevice ? (
                      <div className="mt-1 inline-flex items-center gap-1 rounded-md bg-info/10 px-2 py-0.5 text-[11px] font-semibold text-info">
                        <DeviceMobile size={12} weight="bold" />
                        {td.onOtherDevice}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-foreground">{r.itemCount}</td>
                  <td className="px-4 py-3 font-mono text-xs text-foreground">
                    {r.total == null ? <span className="text-muted">{td.noTotal}</span> : fmtMoney(r.total)}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">{fmtDate(r.updatedAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        href={`/repair/new?draft=${r.id}`}
                        className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg bg-navy px-3 py-1.5 text-xs font-bold text-white hover:bg-navy/90"
                      >
                        {td.continue}
                        <ArrowRight size={13} weight="bold" />
                      </Link>
                      <form action={deleteRepairDraftAction}>
                        <input type="hidden" name="draft_id" value={r.id} />
                        <button
                          type="submit"
                          className="whitespace-nowrap rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-bold text-muted hover:border-danger hover:text-danger"
                        >
                          {td.discard}
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function fmtMoney(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
