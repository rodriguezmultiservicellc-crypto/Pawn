'use client'

import Link from 'next/link'
import { Plus, Scales } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { maxMonthlyRate, type Jurisdiction } from '@/lib/jurisdictions/rules'

type Row = Jurisdiction & { is_active: boolean; tenantCount: number }

export default function JurisdictionsListContent({ rows }: { rows: Row[] }) {
  const { t } = useI18n()
  const ta = t.jurisdiction.admin

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display flex items-center gap-2 text-2xl font-bold text-foreground">
            <Scales size={22} weight="bold" />
            {ta.title}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">{ta.subtitle}</p>
        </div>
        <Link
          href="/admin/jurisdictions/new"
          className="inline-flex items-center gap-1 rounded-xl bg-gold px-3 py-2 text-sm font-bold text-navy transition-all hover:-translate-y-0.5 hover:bg-gold-2 hover:shadow-lg"
        >
          <Plus size={14} weight="bold" />
          {ta.add}
        </Link>
      </header>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-background text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2">{ta.colCode}</th>
              <th className="px-3 py-2">{ta.colName}</th>
              <th className="px-3 py-2">{ta.colRateCap}</th>
              <th className="px-3 py-2">{ta.colGrace}</th>
              <th className="px-3 py-2">{ta.colHold}</th>
              <th className="px-3 py-2">{ta.colRetention}</th>
              <th className="px-3 py-2">{ta.colTenants}</th>
              <th className="px-3 py-2">{ta.colVerified}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-muted">
                  {ta.empty}
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const cap = maxMonthlyRate(r, null)
                return (
                  <tr
                    key={r.code}
                    className={`border-t border-border ${r.is_active ? '' : 'opacity-60'}`}
                  >
                    <td className="px-3 py-2 font-mono">
                      <Link
                        href={`/admin/jurisdictions/${r.code}`}
                        className="text-blue hover:underline"
                      >
                        {r.code}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{r.name}</td>
                    <td className="px-3 py-2 font-mono">
                      {cap == null ? '—' : `${(cap * 100).toFixed(2)}%`}
                      {r.rate_tiers ? ` ${t.jurisdiction.settings.tieredSuffix}` : ''}
                    </td>
                    <td className="px-3 py-2 font-mono">{r.grace_days}</td>
                    <td className="px-3 py-2 font-mono">{r.buy_hold_days}</td>
                    <td className="px-3 py-2 font-mono">
                      {r.record_retention_years ?? '—'}
                    </td>
                    <td className="px-3 py-2 font-mono">{r.tenantCount}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {r.verified_on ?? (
                        <span className="text-warning">{ta.unverifiedBadge}</span>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
