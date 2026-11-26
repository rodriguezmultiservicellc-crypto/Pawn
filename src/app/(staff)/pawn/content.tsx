'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  MagnifyingGlass,
  Plus,
  Coins,
  DotsThree,
  CaretUp,
  CaretDown,
  FileDashed,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { daysBetween, type ChargeModel, type LoanMoneyEvent } from '@/lib/pawn/math'
import type { LoanStatus } from '@/types/database-aliases'
import { RecordPaymentDialog } from '@/components/pawn/RecordPaymentDialog'
import { PayTogetherDialog } from '@/components/pawn/PayTogetherDialog'
import { ReceiptFormatDialog } from '@/components/pos/PrintReceiptDialog'
import { MAX_PAY_TOGETHER } from '@/lib/validations/loan'
import { PrintNewTicketPrompt } from '@/components/pawn/PrintNewTicketPrompt'
import { recordPaymentAction, recordPaymentsAction } from './[id]/actions'

export type PawnListRow = {
  id: string
  ticket_number: string
  customer_id: string
  customer_name: string
  customer_phone: string | null
  principal: number | string
  interest_rate_monthly: number | string
  term_days: number
  issue_date: string
  due_date: string
  status: LoanStatus
  is_printed: boolean
  created_at: string
  collateral_label: string | null
  collateral_extra: number
  payoff: number | null
  accrued_interest: number | null
  /** What Payment / Extend needs to open on the list; null on a closed loan. */
  pay: {
    principal: number
    monthlyRate: number
    minMonthlyCharge: number | null
    issueDate: string
    events: LoanMoneyEvent[]
  } | null
}

export type Counts = {
  active: number
  overdue: number
  dueSoon7: number
  redeemed: number
  forfeited: number
  voided: number
}

export type PawnStats = {
  onLoanNow: number
  activeCount: number
  dueSoonCount: number
  dueSoonValue: number
  overdueCount: number
  overdueValue: number
  redeemedCount: number
  redeemedInterest: number
}

type SortKey = 'due' | 'principal' | 'payoff'

const TERMINAL: ReadonlyArray<LoanStatus> = ['redeemed', 'forfeited', 'voided']

export default function PawnContent({
  rows,
  query,
  statusFilter,
  dueWindow,
  customerFilter,
  counts,
  stats,
  today,
  charge,
  printPrompt,
}: {
  /** A ticket just issued (/pawn?print=<id>): ask to print it now. */
  printPrompt: { loanId: string; ticketNumber: string } | null
  rows: PawnListRow[]
  query: string
  statusFilter: string
  dueWindow: string
  customerFilter: string
  counts: Counts
  stats: PawnStats
  today: string
  /** How the shop's jurisdiction charges a loan (for the payment popup). */
  charge: ChargeModel
}) {
  const { t } = useI18n()
  const router = useRouter()
  const sp = useSearchParams()
  const [searchInput, setSearchInput] = useState(query)
  // The address bar changed the search (Back, Forward, a link): show it.
  const [shownQuery, setShownQuery] = useState(query)
  if (shownQuery !== query) {
    setShownQuery(query)
    setSearchInput(query)
  }
  const [pending, startTransition] = useTransition()
  const [askPrint, setAskPrint] = useState(printPrompt != null)
  function closeAskPrint() {
    setAskPrint(false)
    // Drop ?print= so a reload doesn't ask again; keep the rest.
    const usp = new URLSearchParams(sp.toString())
    usp.delete('print')
    router.replace(`/pawn${usp.toString() ? `?${usp.toString()}` : ''}`, { scroll: false })
  }
  // Payment / Extend opens right here; the customer receipt follows it.
  const [payFor, setPayFor] = useState<PawnListRow | null>(null)
  const [receiptFor, setReceiptFor] = useState<{
    loanId: string
    eventId: string
    amount: number
    ticket: string
  } | null>(null)
  // Pay together: open tickets of ONE customer, ticked on the list.
  const [picked, setPicked] = useState<string[]>([])
  const [payTogetherOpen, setPayTogetherOpen] = useState(false)
  const [groupReceipt, setGroupReceipt] = useState<{
    groupId: string
    total: number
    count: number
  } | null>(null)
  const pickedRows = picked
    .map((id) => rows.find((r) => r.id === id))
    .filter((r): r is PawnListRow => r != null && r.pay != null)
  const pickedCustomer = pickedRows[0]?.customer_id ?? null
  function togglePick(r: PawnListRow) {
    setPicked((ps) =>
      ps.includes(r.id)
        ? ps.filter((id) => id !== r.id)
        : ps.length >= MAX_PAY_TOGETHER
        ? ps
        : [...ps, r.id],
    )
  }
  const [sortKey, setSortKey] = useState<SortKey>('due')
  const [sortDir, setSortDir] = useState<1 | -1>(1)

  function pushParams(next: Record<string, string | null>) {
    const usp = new URLSearchParams(sp.toString())
    // The search box is what the clerk sees, so it is what is searched: a
    // tab or due-date pick with the box emptied must not keep an old search
    // alive in the address bar.
    for (const [k, v] of Object.entries({ q: searchInput.trim(), ...next })) {
      if (v == null || v === '') usp.delete(k)
      else usp.set(k, v)
    }
    startTransition(() => {
      router.push(`/pawn${usp.toString() ? `?${usp.toString()}` : ''}`)
    })
  }

  function onSearchSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    pushParams({ q: searchInput.trim() })
  }

  function setSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 1 ? -1 : 1))
    else {
      setSortKey(key)
      setSortDir(1)
    }
  }

  const sorted = [...rows].sort((a, b) => {
    let av: number
    let bv: number
    if (sortKey === 'due') {
      av = daysBetween(today, a.due_date)
      bv = daysBetween(today, b.due_date)
    } else if (sortKey === 'principal') {
      av = toNum(a.principal)
      bv = toNum(b.principal)
    } else {
      av = a.payoff ?? Number.POSITIVE_INFINITY
      bv = b.payoff ?? Number.POSITIVE_INFINITY
    }
    return (av > bv ? 1 : av < bv ? -1 : 0) * sortDir
  })

  const hasFilter =
    !!query ||
    statusFilter !== 'active' ||
    dueWindow !== 'all' ||
    !!customerFilter

  return (
    <div className="space-y-6">
      {askPrint && printPrompt ? (
        <PrintNewTicketPrompt
          loanId={printPrompt.loanId}
          ticketNumber={printPrompt.ticketNumber}
          onClose={closeAskPrint}
        />
      ) : null}
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold">{t.pawn.title}</h1>
        <div className="flex items-center gap-2">
          <Link
            href="/pawn/drafts"
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-3 text-sm font-bold text-foreground hover:border-gold"
          >
            <FileDashed size={16} weight="bold" />
            <span>{t.pawn.drafts.navTitle}</span>
          </Link>
          <Link
            href="/pawn/new"
            className="inline-flex items-center gap-1 rounded-xl bg-gold px-5 py-3 text-sm font-bold text-navy shadow-lg transition-all hover:-translate-y-0.5 hover:bg-gold-2"
          >
            <Plus size={16} weight="bold" />
            <span>{t.pawn.new}</span>
          </Link>
        </div>
      </div>

      {/* Summary stats strip */}
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <StatCard
          accent="bg-navy"
          label={t.pawn.list.statOnLoan}
          value={fmtMoney(stats.onLoanNow)}
          sub={t.pawn.list.statOnLoanSub.replace('{n}', String(stats.activeCount))}
        />
        <StatCard
          accent="bg-warning"
          label={t.pawn.list.statDueSoon}
          value={String(stats.dueSoonCount)}
          sub={t.pawn.list.statDueSoonSub.replace(
            '{amount}',
            fmtMoney(stats.dueSoonValue),
          )}
        />
        <StatCard
          accent="bg-danger"
          label={t.pawn.list.statOverdue}
          value={String(stats.overdueCount)}
          valueClass="text-danger"
          sub={t.pawn.list.statOverdueSub.replace(
            '{amount}',
            fmtMoney(stats.overdueValue),
          )}
        />
        <StatCard
          accent="bg-success"
          label={t.pawn.list.statRedeemed}
          value={String(stats.redeemedCount)}
          sub={t.pawn.list.statRedeemedSub.replace(
            '{amount}',
            fmtMoney(stats.redeemedInterest),
          )}
          subClass="text-success"
        />
      </div>

      {/* Status chips */}
      <div className="flex flex-wrap gap-2">
        <Chip
          label={t.pawn.list.filterActive}
          count={counts.active}
          active={statusFilter === 'active' && dueWindow === 'all'}
          onClick={() => pushParams({ status: 'active', due: null })}
        />
        <Chip
          label={t.pawn.list.filterOverdue}
          count={counts.overdue}
          active={dueWindow === 'overdue'}
          tone="error"
          onClick={() => pushParams({ status: 'active', due: 'overdue' })}
        />
        <Chip
          label={t.pawn.list.filterDueSoon}
          count={counts.dueSoon7}
          active={dueWindow === 'dueSoon7'}
          tone="warning"
          onClick={() => pushParams({ status: 'active', due: 'dueSoon7' })}
        />
        <Chip
          label={t.pawn.list.filterRedeemed}
          count={counts.redeemed}
          active={statusFilter === 'redeemed'}
          onClick={() => pushParams({ status: 'redeemed', due: null })}
        />
        <Chip
          label={t.pawn.list.filterForfeited}
          count={counts.forfeited}
          active={statusFilter === 'forfeited'}
          onClick={() => pushParams({ status: 'forfeited', due: null })}
        />
        <Chip
          label={t.pawn.list.filterVoided}
          count={counts.voided}
          active={statusFilter === 'voided'}
          onClick={() => pushParams({ status: 'voided', due: null })}
        />
        <Chip
          label={t.pawn.list.filterAll}
          count={null}
          active={statusFilter === 'all'}
          onClick={() => pushParams({ status: 'all', due: null })}
        />
      </div>

      {/* Toolbar */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
        <form
          onSubmit={onSearchSubmit}
          className="flex items-center gap-2 sm:col-span-7"
        >
          <div className="relative flex-1">
            <MagnifyingGlass
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t.pawn.list.searchPlaceholder}
              className="block w-full rounded-xl border border-border bg-card py-2.5 pl-9 pr-3 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
            />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground hover:bg-background disabled:opacity-50"
          >
            {t.common.search}
          </button>
        </form>

        <select
          value={dueWindow}
          onChange={(e) => pushParams({ due: e.target.value })}
          className="rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-medium text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10 sm:col-span-4"
        >
          <option value="all">{t.pawn.list.dueWindowAll}</option>
          <option value="overdue">{t.pawn.list.dueWindowOverdue}</option>
          <option value="dueSoon7">{t.pawn.list.dueWindowDueSoon7}</option>
          <option value="dueSoon14">{t.pawn.list.dueWindowDueSoon14}</option>
        </select>

        {hasFilter ? (
          <button
            type="button"
            onClick={() => {
              setSearchInput('')
              pushParams({ q: null, status: null, due: null, customer: null })
            }}
            className="rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground hover:bg-background sm:col-span-1"
          >
            {t.common.clear}
          </button>
        ) : null}
      </div>

      {pickedRows.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gold bg-gold/10 px-4 py-3">
          <span className="text-sm font-semibold text-foreground">
            {pickedRows[0].customer_name} · {pickedRows.map((r) => r.ticket_number).join(', ')}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPicked([])}
              className="rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-background"
            >
              {t.pawn.payTogether.clear}
            </button>
            <button
              type="button"
              disabled={pickedRows.length < 2}
              onClick={() => setPayTogetherOpen(true)}
              className="inline-flex items-center gap-1 rounded-xl bg-gold px-4 py-2 text-sm font-bold text-navy transition-all hover:-translate-y-0.5 hover:bg-gold-2 hover:shadow-lg disabled:opacity-50 disabled:hover:translate-y-0"
            >
              {t.pawn.payTogether.button.replace('{n}', String(pickedRows.length))}
            </button>
          </div>
        </div>
      ) : null}

      {/* Table */}
      {rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <Coins size={32} weight="light" className="mx-auto mb-3 text-muted" />
          <p className="text-muted">
            {hasFilter ? t.pawn.list.emptyForFilter : t.pawn.list.empty}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead className="border-b border-border text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="w-10 py-3 pl-4" />
                <th className="px-4 py-3 font-bold">{t.pawn.list.ticket}</th>
                <th className="px-4 py-3 font-bold">{t.pawn.list.customer}</th>
                <th className="px-4 py-3 font-bold">{t.pawn.list.collateral}</th>
                <SortHeader
                  label={t.pawn.list.principal}
                  active={sortKey === 'principal'}
                  dir={sortDir}
                  onClick={() => setSort('principal')}
                />
                <SortHeader
                  label={t.pawn.list.payoffDue}
                  active={sortKey === 'payoff'}
                  dir={sortDir}
                  onClick={() => setSort('payoff')}
                />
                <SortHeader
                  label={t.pawn.list.dueDate}
                  active={sortKey === 'due'}
                  dir={sortDir}
                  onClick={() => setSort('due')}
                />
                <th className="px-4 py-3 text-right font-bold">
                  {t.common.actions}
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const isTerminal = TERMINAL.includes(r.status)
                const days = daysBetween(today, r.due_date)
                const isOverdue = !isTerminal && days < 0
                const isDueSoon = !isTerminal && days >= 0 && days <= 7
                const accent = isOverdue
                  ? 'border-l-danger'
                  : isDueSoon
                  ? 'border-l-warning'
                  : 'border-l-transparent'
                return (
                  <tr
                    key={r.id}
                    className="cursor-pointer border-b border-border transition-colors last:border-b-0 hover:bg-background"
                    onClick={() => router.push(`/pawn/${r.id}`)}
                  >
                    <td
                      className={`border-l-4 ${accent} py-3 pl-4`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {r.pay ? (
                        <input
                          type="checkbox"
                          checked={picked.includes(r.id)}
                          disabled={pickedCustomer != null && pickedCustomer !== r.customer_id}
                          title={
                            pickedCustomer != null && pickedCustomer !== r.customer_id
                              ? t.pawn.payTogether.oneCustomer
                              : undefined
                          }
                          onChange={() => togglePick(r)}
                          aria-label={t.pawn.payTogether.select.replace('{ticket}', r.ticket_number)}
                          className="h-4 w-4 cursor-pointer accent-navy disabled:cursor-not-allowed disabled:opacity-30"
                        />
                      ) : null}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs font-bold text-navy">
                      {r.ticket_number}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-foreground">
                        {r.customer_name}
                      </div>
                      {r.customer_phone ? (
                        <div className="text-xs text-muted">
                          {r.customer_phone}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {r.collateral_label ? (
                        <span className="font-medium text-foreground">
                          {r.collateral_label}
                          {r.collateral_extra > 0 ? (
                            <span className="ml-1 text-xs font-bold text-muted">
                              {t.pawn.list.moreCount.replace(
                                '{n}',
                                String(r.collateral_extra),
                              )}
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-foreground">
                      {fmtMoney(r.principal)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {r.payoff == null ? (
                        <span className="text-muted">—</span>
                      ) : (
                        <span className="font-bold text-foreground">
                          {fmtMoney(r.payoff)}
                          {r.accrued_interest && r.accrued_interest > 0 ? (
                            <span className="block text-[10px] font-semibold text-muted">
                              +{fmtMoney(r.accrued_interest)} {t.pawn.list.intSuffix}
                            </span>
                          ) : null}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-mono text-xs font-semibold text-foreground">
                        {r.due_date}
                      </div>
                      <div
                        className={`text-[11px] font-bold ${
                          isOverdue
                            ? 'text-danger'
                            : isDueSoon
                            ? 'text-warning'
                            : 'text-muted'
                        }`}
                      >
                        {isTerminal
                          ? '—'
                          : isOverdue
                          ? t.pawn.list.relOverdue.replace(
                              '{n}',
                              String(Math.abs(days)),
                            )
                          : t.pawn.list.relDueIn.replace('{n}', String(days))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div
                        className="flex items-center justify-end gap-1.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {isTerminal ? (
                          <button
                            type="button"
                            onClick={() => router.push(`/pawn/${r.id}`)}
                            className="whitespace-nowrap rounded-lg bg-background px-3 py-1.5 text-xs font-bold text-muted hover:bg-border"
                          >
                            {t.pawn.list.view}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => (r.pay ? setPayFor(r) : router.push(`/pawn/${r.id}`))}
                            className="whitespace-nowrap rounded-lg bg-navy px-3 py-1.5 text-xs font-bold text-white hover:bg-navy/90"
                          >
                            {t.pawn.list.takePayment}
                          </button>
                        )}
                        <RowMenu
                          row={r}
                          isTerminal={isTerminal}
                          onPay={r.pay ? () => setPayFor(r) : undefined}
                        />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Payment / Extend, right on the list. Same dialog and same server
          action as the ticket page. */}
      {payFor && payFor.pay ? (
        <RecordPaymentDialog
          loanId={payFor.id}
          ticketLabel={`${payFor.ticket_number} · ${payFor.customer_name}`}
          loan={{ ...payFor.pay, dueDate: payFor.due_date, charge }}
          today={today}
          payoff={payFor.payoff ?? 0}
          onClose={() => setPayFor(null)}
          onSubmit={async (fd) => {
            const paid = payFor
            const res = await recordPaymentAction(fd)
            if (!res.error) {
              if (res.eventId) {
                setReceiptFor({
                  loanId: paid.id,
                  eventId: res.eventId,
                  amount: parseFloat(String(fd.get('amount') ?? '0')) || 0,
                  ticket: paid.ticket_number,
                })
              }
              router.refresh()
            }
            return res
          }}
        />
      ) : null}
      {payTogetherOpen && pickedRows.length >= 2 ? (
        <PayTogetherDialog
          tickets={pickedRows.map((r) => ({
            id: r.id,
            ticket_number: r.ticket_number,
            payoff: r.payoff ?? 0,
            loan: { ...r.pay!, dueDate: r.due_date, charge },
          }))}
          customerName={pickedRows[0].customer_name}
          today={today}
          onClose={() => {
            setPayTogetherOpen(false)
            router.refresh()
          }}
          onSubmit={(input) => recordPaymentsAction(input)}
          onDone={(groupId, total) => {
            setGroupReceipt({ groupId, total, count: pickedRows.length })
            setPayTogetherOpen(false)
            setPicked([])
            router.refresh()
          }}
        />
      ) : null}
      {groupReceipt ? (
        <ReceiptFormatDialog
          body={t.pawn.detail.receipt.groupDialogBody
            .replace('{total}', fmtMoney(groupReceipt.total))
            .replace('{count}', String(groupReceipt.count))}
          urlFor={(format) => `/api/print/loan-payments/${groupReceipt.groupId}?format=${format}`}
          onClose={() => setGroupReceipt(null)}
        />
      ) : null}
      {/* The customer's receipt, offered as soon as the payment is in. */}
      {receiptFor ? (
        <ReceiptFormatDialog
          body={t.pawn.detail.receipt.dialogBody
            .replace('{total}', fmtMoney(receiptFor.amount))
            .replace('{number}', receiptFor.ticket)}
          urlFor={(format) =>
            `/api/print/loan/${receiptFor.loanId}/payment/${receiptFor.eventId}?format=${format}`
          }
          onClose={() => setReceiptFor(null)}
        />
      ) : null}
    </div>
  )
}

function StatCard({
  accent,
  label,
  value,
  valueClass,
  sub,
  subClass,
}: {
  accent: string
  label: string
  value: string
  valueClass?: string
  sub: string
  subClass?: string
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-card p-4 shadow-sm">
      <span className={`absolute bottom-0 left-0 top-0 w-1 ${accent}`} />
      <div className="text-[11px] font-bold uppercase tracking-wide text-muted">
        {label}
      </div>
      <div
        className={`mt-1.5 font-mono text-2xl font-bold tracking-tight ${valueClass ?? 'text-foreground'}`}
      >
        {value}
      </div>
      <div className={`mt-0.5 text-xs font-semibold text-muted ${subClass ?? ''}`}>
        {sub}
      </div>
    </div>
  )
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string
  active: boolean
  dir: 1 | -1
  onClick: () => void
}) {
  return (
    <th className="px-4 py-3 font-bold">
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-foreground ${
          active ? 'text-foreground' : ''
        }`}
      >
        {label}
        {active ? (
          dir === 1 ? (
            <CaretUp size={11} weight="bold" />
          ) : (
            <CaretDown size={11} weight="bold" />
          )
        ) : null}
      </button>
    </th>
  )
}

function RowMenu({
  row,
  isTerminal,
  onPay,
}: {
  row: PawnListRow
  isTerminal: boolean
  /** Opens Payment / Extend on the list (paying and extending are one act). */
  onPay?: () => void
}) {
  const { t } = useI18n()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(
    null,
  )
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    function close() {
      setOpen(false)
    }
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  function toggle(e: React.MouseEvent) {
    e.stopPropagation()
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      setCoords({ top: rect.bottom + 6, right: window.innerWidth - rect.right })
    }
    setOpen((o) => !o)
  }

  function go(href: string) {
    setOpen(false)
    router.push(href)
  }

  function printTicket() {
    setOpen(false)
    window.open(`/api/print/loan/${row.id}`, '_blank', 'noopener,noreferrer')
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={t.pawn.list.rowActions}
        onClick={toggle}
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-muted hover:border-gold"
      >
        <DotsThree size={18} weight="bold" />
      </button>
      {open && coords
        ? createPortal(
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ top: coords.top, right: coords.right }}
              className="fixed z-50 min-w-[170px] rounded-xl border border-border bg-card p-1.5 shadow-lg"
            >
              <MenuItem
                label={t.pawn.list.viewTicket}
                onClick={() => go(`/pawn/${row.id}`)}
              />
              {!isTerminal ? (
                <>
                  <MenuItem
                    label={t.pawn.list.extendRenew}
                    onClick={() => {
                      if (!onPay) return go(`/pawn/${row.id}`)
                      setOpen(false)
                      onPay()
                    }}
                  />
                  <MenuItem
                    label={t.pawn.list.redeem}
                    onClick={() => go(`/pawn/${row.id}`)}
                  />
                </>
              ) : null}
              <MenuItem label={t.pawn.list.printTicket} onClick={printTicket} />
              {!isTerminal ? (
                <MenuItem
                  label={t.pawn.list.markForfeited}
                  danger
                  onClick={() => go(`/pawn/${row.id}`)}
                />
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}

function MenuItem({
  label,
  onClick,
  danger,
}: {
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full rounded-lg px-3 py-2 text-left text-sm font-semibold hover:bg-background ${
        danger ? 'text-danger' : 'text-foreground'
      }`}
    >
      {label}
    </button>
  )
}

function Chip({
  label,
  count,
  active,
  tone,
  onClick,
}: {
  label: string
  count: number | null
  active: boolean
  tone?: 'error' | 'warning'
  onClick: () => void
}) {
  const base =
    'inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-bold transition-colors'
  const activeClass =
    tone === 'error'
      ? 'border-danger bg-danger text-white'
      : tone === 'warning'
      ? 'border-warning bg-warning text-white'
      : 'border-navy bg-navy text-white'
  const idleClass = 'border-border bg-card text-foreground hover:border-gold'
  const countClass = active
    ? 'bg-white/20 text-white'
    : 'bg-background text-muted'
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${base} ${active ? activeClass : idleClass}`}
    >
      {label}
      {count != null ? (
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${countClass}`}>
          {count}
        </span>
      ) : null}
    </button>
  )
}

function toNum(v: number | string): number {
  const n = typeof v === 'string' ? parseFloat(v) : v
  return isFinite(n) ? n : 0
}

function fmtMoney(v: number | string): string {
  const n = typeof v === 'string' ? parseFloat(v) : v
  if (!isFinite(n)) return '—'
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  })
}
