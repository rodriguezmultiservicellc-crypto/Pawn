'use client'

import Link from 'next/link'
import { FileDashed, Plus, ArrowRight } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { deleteLoanDraft } from './actions'

export type DraftRow = {
  id: string
  customerName: string
  customerPhone: string | null
  itemCount: number
  principal: string | null
  updatedAt: string
}

export default function DraftsContent({ rows }: { rows: DraftRow[] }) {
  const { t } = useI18n()
  const td = t.pawn.drafts

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">{td.title}</h1>
          <p className="mt-0.5 text-sm text-muted">{td.subtitle}</p>
        </div>
        <Link
          href="/pawn/new"
          className="inline-flex items-center gap-1 rounded-xl bg-gold px-5 py-3 text-sm font-bold text-navy shadow-lg transition-all hover:-translate-y-0.5 hover:bg-gold-2"
        >
          <Plus size={16} weight="bold" />
          <span>{t.pawn.new}</span>
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <FileDashed size={32} weight="light" className="mx-auto mb-3 text-muted" />
          <p className="text-muted">{td.empty}</p>
          <Link
            href="/pawn"
            className="mt-3 inline-block text-sm font-semibold text-blue hover:underline"
          >
            {td.backToLoans}
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3 font-bold">{td.customer}</th>
                <th className="px-4 py-3 font-bold">{td.items}</th>
                <th className="px-4 py-3 font-bold">{td.principal}</th>
                <th className="px-4 py-3 font-bold">{td.savedAt}</th>
                <th className="px-4 py-3 text-right font-bold">
                  {t.common.actions}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-border transition-colors last:border-b-0 hover:bg-background"
                >
                  <td className="px-4 py-3">
                    <div className="font-semibold text-foreground">
                      {r.customerName}
                    </div>
                    {r.customerPhone ? (
                      <div className="text-xs text-muted">{r.customerPhone}</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-foreground">
                    {r.itemCount}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-foreground">
                    {r.principal == null ? (
                      <span className="text-muted">{td.noPrincipal}</span>
                    ) : (
                      fmtMoney(r.principal)
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">
                    {fmtDate(r.updatedAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        href={`/pawn/new?draft=${r.id}`}
                        className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg bg-navy px-3 py-1.5 text-xs font-bold text-white hover:bg-navy/90"
                      >
                        {td.continue}
                        <ArrowRight size={13} weight="bold" />
                      </Link>
                      <form action={deleteLoanDraft}>
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

function fmtMoney(v: string): string {
  const n = parseFloat(v)
  if (!isFinite(n)) return '—'
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  })
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
