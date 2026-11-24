'use client'

import Link from 'next/link'
import { CaretLeft, Warning, Shield, FileCsv } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { DateRangePicker } from '@/components/reports/DateRangePicker'
import type { PoliceReportFormat } from '@/types/database-aliases'
import type { LeadsOnlineRow } from '@/lib/compliance/police-report/formats/fl-leadsonline'
import type { VoidedAfterReport } from '@/lib/reports/police-report'

const SUPPORTED_FORMATS: PoliceReportFormat[] = ['fl_leadsonline']

export default function PoliceReportContent({
  from,
  to,
  format,
  storeId,
  previewRows,
  complianceRowCount,
  flattenedRowCount,
  counts,
  voidedAfterReport,
}: {
  from: string
  to: string
  format: PoliceReportFormat
  storeId: string
  previewRows: LeadsOnlineRow[]
  complianceRowCount: number
  flattenedRowCount: number
  counts: { rows: number; pawn_intakes: number; buy_outrights: number }
  /** Tickets voided after a file reported them (patches/0108). */
  voidedAfterReport: VoidedAfterReport[]
}) {
  const { t } = useI18n()

  const params = new URLSearchParams({
    from,
    to,
    format,
    storeId,
  })

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link
            href="/reports"
            className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground"
          >
            <CaretLeft size={14} weight="regular" />
            {t.reports.title}
          </Link>
          <h1 className="font-display mt-1 flex items-center gap-2 text-2xl font-bold text-foreground">
            <Shield size={22} weight="regular" className="text-gold" />
            {t.compliance.title}
          </h1>
          <p className="max-w-2xl text-sm text-muted">{t.compliance.subtitle}</p>
        </div>
        <a
          href={`/api/reports/police-report/csv?${params.toString()}`}
          className="inline-flex items-center gap-2 rounded-md border border-navy bg-navy px-3 py-2 text-sm text-white hover:bg-navy/90"
        >
          <FileCsv size={16} weight="regular" />
          {t.compliance.downloadCsv}
        </a>
      </div>

      <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm text-warning">
        <div className="flex items-start gap-2">
          <Warning size={18} weight="regular" />
          <span>{t.compliance.formatDraftWarning}</span>
        </div>
      </div>

      {voidedAfterReport.length > 0 ? (
        <div className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm">
          <div className="flex items-start gap-2 text-danger">
            <Warning size={18} weight="fill" className="mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold">{t.compliance.voidedAfterReport.title}</p>
              <p className="text-foreground">{t.compliance.voidedAfterReport.body}</p>
            </div>
          </div>
          <table className="mt-3 w-full text-left text-xs">
            <thead className="text-muted">
              <tr>
                <th className="py-1 pr-3 font-medium">{t.compliance.voidedAfterReport.ticket}</th>
                <th className="py-1 pr-3 font-medium">{t.compliance.voidedAfterReport.reportedOn}</th>
                <th className="py-1 pr-3 font-medium">{t.compliance.voidedAfterReport.voidedOn}</th>
                <th className="py-1 pr-3 font-medium">{t.compliance.voidedAfterReport.voidSent}</th>
                <th className="py-1 font-medium" />
              </tr>
            </thead>
            <tbody>
              {voidedAfterReport.map((v) => (
                <tr key={v.loan_id} className="border-t border-danger/20">
                  <td className="py-1.5 pr-3 font-mono">
                    <Link href={`/pawn/${v.loan_id}`} className="text-blue hover:underline">
                      {v.ticket_number}
                    </Link>
                  </td>
                  <td className="py-1.5 pr-3 font-mono">{v.reported_at ? v.reported_at.slice(0, 10) : '—'}</td>
                  <td className="py-1.5 pr-3 font-mono">{v.voided_at.slice(0, 10)}</td>
                  <td className="py-1.5 pr-3 font-mono">
                    {v.resent_at ? v.resent_at.slice(0, 10) : t.compliance.voidedAfterReport.voidPending}
                  </td>
                  <td className="py-1.5 text-right">
                    {v.reported_batch_id ? (
                      <a
                        href={`/api/compliance/export/${v.reported_batch_id}`}
                        className="text-blue hover:underline"
                      >
                        {t.compliance.voidedAfterReport.reportedFile}
                      </a>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <DateRangePicker from={from} to={to} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs text-muted">
          <span>{t.compliance.formatLabel}</span>
          <select
            value={format}
            onChange={(e) => {
              const next = new URLSearchParams(window.location.search)
              next.set('format', e.target.value)
              window.location.search = next.toString()
            }}
            className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
          >
            {SUPPORTED_FORMATS.map((f) => (
              <option key={f} value={f}>
                {t.compliance.formats[f]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted sm:col-span-2">
          <span>{t.compliance.storeIdLabel}</span>
          <input
            type="text"
            value={storeId}
            readOnly
            className="rounded-md border border-border bg-background px-3 py-2 font-mono text-xs text-foreground"
          />
          <span className="text-xs text-muted">{t.compliance.storeIdHelp}</span>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label={t.compliance.eventTypes.pawn_intake} value={String(counts.pawn_intakes)} />
        <Tile label={t.compliance.eventTypes.buy_outright} value={String(counts.buy_outrights)} />
        <Tile label="Compliance rows" value={String(complianceRowCount)} />
        <Tile label="CSV rows" value={String(flattenedRowCount)} />
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium text-foreground">
          {t.compliance.preview.title}
        </h2>
        <p className="mb-2 text-xs text-muted">
          {t.compliance.preview.rowCount
            .replace('{rows}', String(complianceRowCount))
            .replace('{flattened}', String(flattenedRowCount))}
        </p>
        {previewRows.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-12 text-center text-muted">
            {t.reports.empty}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Customer</th>
                  <th className="px-3 py-2 font-medium">ID</th>
                  <th className="px-3 py-2 font-medium">Item</th>
                  <th className="px-3 py-2 text-right font-medium">Qty</th>
                  <th className="px-3 py-2 text-right font-medium">Unit</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((r, i) => (
                  <tr
                    key={i}
                    className="border-b border-border last:border-0 hover:bg-background"
                  >
                    <td className="px-3 py-2 font-mono text-xs">
                      {r.transaction_date}
                    </td>
                    <td className="px-3 py-2">{r.transaction_type}</td>
                    <td className="px-3 py-2">
                      {[r.customer_first_name, r.customer_middle_name, r.customer_last_name]
                        .filter(Boolean)
                        .join(' ')}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {r.customer_id_type
                        ? `${r.customer_id_type} ${r.customer_id_number}`
                        : '—'}
                    </td>
                    <td className="px-3 py-2">{r.item_description || '—'}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      {r.item_quantity}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      {r.item_unit_amount}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      {r.item_total_amount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 font-mono text-lg font-bold text-foreground">{value}</div>
    </div>
  )
}
