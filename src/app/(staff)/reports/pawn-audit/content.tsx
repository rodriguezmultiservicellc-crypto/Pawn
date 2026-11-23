'use client'

import Link from 'next/link'
import { useI18n } from '@/lib/i18n/context'
import { ReportPageShell } from '@/components/reports/ReportPageShell'
import { ReportTable, type ReportColumn } from '@/components/reports/ReportTable'
import { formatMoney, shortDate } from '@/lib/format/money'
import { auditItemDetail, type PawnAuditRow } from '@/lib/reports/pawn-audit'

export default function PawnAuditContent({
  today,
  rows,
  totals,
}: {
  today: string
  rows: PawnAuditRow[]
  totals: Record<string, number>
}) {
  const { t } = useI18n()
  const a = t.reports.pawnAudit
  const c = a.columns
  const labels = { size: a.size, serial: a.serial }

  const columns: ReportColumn<PawnAuditRow>[] = [
    {
      key: 'check',
      header: c.check,
      align: 'center',
      width: '56px',
      // An empty box to tick on the printed page (or on a tablet, by eye).
      render: (r) =>
        r.item_count === 0 ? null : (
          <span className="inline-block h-4 w-4 rounded-md border border-foreground/50 align-middle" aria-hidden />
        ),
    },
    {
      key: 'ticket',
      header: c.ticket,
      mono: true,
      render: (r) =>
        r.first ? (
          <Link href={`/pawn/${r.loan_id}`} className="font-semibold text-blue hover:underline">
            {r.ticket_number}
          </Link>
        ) : null,
    },
    { key: 'customer', header: c.customer, render: (r) => (r.first ? r.customer_name : null) },
    { key: 'issued', header: c.issued, mono: true, render: (r) => (r.first ? shortDate(r.issue_date) : null) },
    { key: 'due', header: c.due, mono: true, render: (r) => (r.first ? shortDate(r.due_date) : null) },
    {
      key: 'piece',
      header: c.piece,
      align: 'center',
      mono: true,
      render: (r) => (r.item_count === 0 ? '—' : `${r.item_no}/${r.item_count}`),
    },
    {
      key: 'description',
      header: c.description,
      render: (r) => {
        if (r.item_count === 0) return <span className="text-danger">{a.noItems}</span>
        const detail = auditItemDetail(r, labels)
        return (
          <div>
            <div className="text-foreground">{r.description}</div>
            {detail ? <div className="font-mono text-xs text-muted">{detail}</div> : null}
          </div>
        )
      },
    },
    {
      key: 'loan',
      header: c.loan,
      align: 'right',
      mono: true,
      render: (r) => (r.first ? formatMoney(r.principal) : null),
    },
  ]

  const tiles = [
    { label: a.totals.tickets, value: String(totals.tickets ?? 0) },
    { label: a.totals.pieces, value: String(totals.pieces ?? 0) },
    { label: a.totals.principal, value: formatMoney(totals.principal ?? 0) },
    ...((totals.tickets_without_items ?? 0) > 0
      ? [{ label: a.totals.withoutItems, value: String(totals.tickets_without_items) }]
      : []),
  ]

  return (
    <ReportPageShell
      title={t.reports.landing.pawnAudit.title}
      slug="pawn-audit"
      from={today}
      to={today}
      totals={tiles}
      hideRange
    >
      <p className="text-sm text-muted">{a.intro}</p>
      <ReportTable rows={rows} columns={columns} empty={a.empty} />
    </ReportPageShell>
  )
}
