'use client'

import { useState, useTransition } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import {
  ArrowLeft,
  CashRegister,
  CalendarPlus,
  CheckCircle,
  Image as ImageIcon,
  Lock,
  LockOpen,
  Printer,
  Prohibit,
  Warning,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { PayoffCalculator } from '@/components/pawn/PayoffCalculator'
import { RecordPaymentDialog } from '@/components/pawn/RecordPaymentDialog'
import { ExtendLoanDialog } from '@/components/pawn/ExtendLoanDialog'
import { ForfeitConfirmDialog } from '@/components/pawn/ForfeitConfirmDialog'
import { VoidLoanDialog } from '@/components/pawn/VoidLoanDialog'
import { RedeemConfirmDialog } from '@/components/pawn/RedeemConfirmDialog'
import { SendReminderDialog } from '@/components/comms/SendReminderDialog'
import { manualSendAction } from '@/app/(staff)/settings/communications/actions'
import {
  extendLoanAction,
  forfeitLoanAction,
  printTicketAction,
  recordPaymentAction,
  redeemLoanAction,
  voidLoanAction,
  type ActionResult,
} from './actions'
import type { PayoffResult } from '@/lib/pawn/math'
import type {
  InventoryCategory,
  LoanEventType,
  LoanStatus,
  MetalType,
  PaymentMethod,
} from '@/types/database-aliases'

export type LoanView = {
  id: string
  tenant_id: string
  customer_id: string
  customer_name: string
  customer_phone: string | null
  customer_email: string | null
  ticket_number: string
  principal: number
  interest_rate_monthly: number
  min_monthly_charge: number | null
  term_days: number
  issue_date: string
  due_date: string
  status: LoanStatus
  is_printed: boolean
  printed_at: string | null
  signature_signed_url: string | null
  notes: string | null
  created_at: string
}

export type LoanCollateralView = {
  id: string
  description: string
  category: InventoryCategory
  metal_type: MetalType | null
  karat: number | null
  weight_grams: number | null
  est_value: number
  photo_path: string | null
  photo_signed_url: string | null
  position: number
}

export type LoanEventView = {
  id: string
  event_type: LoanEventType
  amount: number | null
  principal_paid: number
  interest_paid: number
  fees_paid: number
  payment_method: PaymentMethod | null
  new_due_date: string | null
  notes: string | null
  occurred_at: string
}

const STATUS_BADGE: Record<LoanStatus, { bg: string; text: string }> = {
  active: { bg: 'bg-success/10 border-success/30', text: 'text-success' },
  extended: { bg: 'bg-success/10 border-success/30', text: 'text-success' },
  partial_paid: { bg: 'bg-warning/10 border-warning/30', text: 'text-warning' },
  redeemed: { bg: 'bg-background border-border', text: 'text-muted' },
  forfeited: { bg: 'bg-background border-border', text: 'text-muted' },
  voided: { bg: 'bg-background border-border', text: 'text-muted' },
}

type DialogKind = 'payment' | 'extend' | 'redeem' | 'forfeit' | 'void' | null

export default function PawnLoanDetail({
  loan,
  collateral,
  events,
  payoff,
  today,
}: {
  loan: LoanView
  collateral: LoanCollateralView[]
  events: LoanEventView[]
  payoff: PayoffResult
  today: string
}) {
  const { t } = useI18n()
  const [dialog, setDialog] = useState<DialogKind>(null)
  const [printPending, startPrintTransition] = useTransition()
  const [printToast, setPrintToast] = useState<string | null>(null)
  const [showReminder, setShowReminder] = useState(false)

  const isTerminal =
    loan.status === 'redeemed' ||
    loan.status === 'forfeited' ||
    loan.status === 'voided'

  const badge = STATUS_BADGE[loan.status]

  function onPrint() {
    setPrintToast(null)
    const open = () => {
      // Open the PDF in a new tab so the user can preview, save, or print.
      window.open(`/api/print/loan/${loan.id}`, '_blank', 'noopener,noreferrer')
    }
    if (loan.is_printed) {
      // Already locked — just re-render the PDF without firing the action.
      open()
      return
    }
    startPrintTransition(async () => {
      const res = await printTicketAction(loan.id)
      if (res.error) {
        setPrintToast(res.error)
        return
      }
      setPrintToast(t.pawn.actions.lockedNotice)
      open()
    })
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/pawn"
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft size={14} weight="bold" />
          {t.pawn.backToList}
        </Link>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowReminder(true)}
            className="rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground hover:border-foreground"
          >
            {t.comms.sendReminderButton}
          </button>
          {loan.is_printed ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-xs font-medium text-foreground">
              <Lock size={12} weight="bold" />
              {t.pawn.detail.printedBadge}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/5 px-2 py-0.5 text-xs font-medium text-warning">
              <LockOpen size={12} weight="bold" />
              {t.pawn.detail.unprintedBadge}
            </span>
          )}
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${badge.bg} ${badge.text}`}
          >
            {labelForStatus(loan.status, t)}
          </span>
        </div>
      </div>
      {showReminder ? (
        <SendReminderDialog
          customerId={loan.customer_id}
          customerName={loan.customer_name}
          allowedKinds={[
            'loan_maturity_t7',
            'loan_maturity_t1',
            'loan_due_today',
            'loan_overdue_t1',
            'loan_overdue_t7',
            'custom',
          ]}
          defaultKind="loan_maturity_t1"
          related={{ loanId: loan.id }}
          onClose={() => setShowReminder(false)}
          action={manualSendAction}
        />
      ) : null}

      {/* Header */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted">
              {t.pawn.detail.ticketLabel}
            </div>
            <h1 className="font-mono text-2xl font-bold text-foreground">
              {loan.ticket_number}
            </h1>
          </div>
          <div className="min-w-[200px]">
            <div className="text-xs uppercase tracking-wide text-muted">
              {t.pawn.detail.customerLabel}
            </div>
            <Link
              href={`/customers/${loan.customer_id}`}
              className="text-base font-semibold text-foreground hover:underline"
            >
              {loan.customer_name}
            </Link>
            <div className="text-xs text-muted">
              {[loan.customer_phone, loan.customer_email]
                .filter(Boolean)
                .join(' · ') || '—'}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted">
              {t.pawn.detail.issuedOn}
            </div>
            <div className="font-mono text-sm text-foreground">{loan.issue_date}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted">
              {t.pawn.detail.dueOn}
            </div>
            <div className="font-mono text-sm text-foreground">{loan.due_date}</div>
          </div>
        </div>
      </div>

      {/* Action row */}
      <ActionRow
        loanId={loan.id}
        isTerminal={isTerminal}
        onAction={(k) => setDialog(k)}
        onPrint={onPrint}
        printPending={printPending}
        isPrinted={loan.is_printed}
      />
      {printToast ? (
        <div className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground">
          {printToast}
        </div>
      ) : null}

      {/* Payoff + collateral grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <PayoffCalculator
            payoff={payoff}
            dueDate={loan.due_date}
            today={today}
          />

          {loan.signature_signed_url ? (
            <a
              href={loan.signature_signed_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground hover:border-foreground"
            >
              {t.pawn.detail.signatureView}
            </a>
          ) : null}
        </div>

        <div className="lg:col-span-2">
          <CollateralPanel collateral={collateral} />
        </div>
      </div>

      <EventLogPanel events={events} />

      {dialog === 'payment' ? (
        <RecordPaymentDialog
          loanId={loan.id}
          payoff={payoff.payoff}
          outstandingInterest={payoff.interestOutstanding}
          onClose={() => setDialog(null)}
          onSubmit={(fd) => actionWithToast(recordPaymentAction(fd))}
        />
      ) : null}
      {dialog === 'extend' ? (
        <ExtendLoanDialog
          loanId={loan.id}
          onClose={() => setDialog(null)}
          onSubmit={(fd) => actionWithToast(extendLoanAction(fd))}
        />
      ) : null}
      {dialog === 'redeem' ? (
        <RedeemConfirmDialog
          loanId={loan.id}
          payoff={payoff.payoff}
          onClose={() => setDialog(null)}
          onSubmit={(fd) => actionWithToast(redeemLoanAction(fd))}
        />
      ) : null}
      {dialog === 'forfeit' ? (
        <ForfeitConfirmDialog
          loanId={loan.id}
          onClose={() => setDialog(null)}
          onSubmit={(fd) => actionWithToast(forfeitLoanAction(fd))}
        />
      ) : null}
      {dialog === 'void' ? (
        <VoidLoanDialog
          loanId={loan.id}
          onClose={() => setDialog(null)}
          onSubmit={(fd) => actionWithToast(voidLoanAction(fd))}
        />
      ) : null}
    </div>
  )
}

async function actionWithToast(p: Promise<ActionResult>): Promise<ActionResult> {
  const res = await p
  return res
}

function ActionRow({
  loanId,
  isTerminal,
  onAction,
  onPrint,
  printPending,
  isPrinted,
}: {
  loanId: string
  isTerminal: boolean
  onAction: (k: NonNullable<DialogKind>) => void
  onPrint: () => void
  printPending: boolean
  isPrinted: boolean
}) {
  const { t } = useI18n()
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ActionButton
        label={t.pawn.actions.recordPayment}
        icon={<CashRegister size={14} weight="bold" />}
        onClick={() => onAction('payment')}
        disabled={isTerminal}
        primary
      />
      <ActionButton
        label={t.pawn.actions.extend}
        icon={<CalendarPlus size={14} weight="bold" />}
        onClick={() => onAction('extend')}
        disabled={isTerminal}
      />
      <ActionButton
        label={t.pawn.actions.redeem}
        icon={<CheckCircle size={14} weight="bold" />}
        onClick={() => onAction('redeem')}
        disabled={isTerminal}
        tone="success"
      />
      <ActionButton
        label={t.pawn.actions.forfeit}
        icon={<Warning size={14} weight="bold" />}
        onClick={() => onAction('forfeit')}
        disabled={isTerminal}
        tone="warning"
      />
      <ActionButton
        label={t.pawn.actions.void}
        icon={<Prohibit size={14} weight="bold" />}
        onClick={() => onAction('void')}
        disabled={isTerminal}
        tone="error"
      />
      <div className="ml-auto">
        <ActionButton
          label={
            isPrinted
              ? t.pawn.actions.reprintTicket
              : t.pawn.actions.printTicket
          }
          icon={<Printer size={14} weight="bold" />}
          onClick={onPrint}
          disabled={printPending}
        />
      </div>
      <input type="hidden" data-loan-id={loanId} />
    </div>
  )
}

function ActionButton({
  label,
  icon,
  onClick,
  disabled,
  primary,
  tone,
}: {
  label: string
  icon: React.ReactNode
  onClick: () => void
  disabled?: boolean
  primary?: boolean
  tone?: 'success' | 'warning' | 'error'
}) {
  let cls =
    'inline-flex items-center gap-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50'
  if (primary) {
    cls +=
      ' border-gold bg-gold text-navy hover:bg-gold-2 disabled:hover:bg-gold'
  } else if (tone === 'success') {
    cls += ' border-success/30 bg-success/5 text-success hover:bg-success/10'
  } else if (tone === 'warning') {
    cls += ' border-warning/30 bg-warning/5 text-warning hover:bg-warning/10'
  } else if (tone === 'error') {
    cls += ' border-danger/30 bg-danger/5 text-danger hover:bg-danger/10'
  } else {
    cls += ' border-border bg-card text-foreground hover:border-foreground'
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cls}>
      {icon}
      {label}
    </button>
  )
}

function CollateralPanel({ collateral }: { collateral: LoanCollateralView[] }) {
  const { t } = useI18n()
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold text-foreground">
        {t.pawn.detail.collateralPanelTitle}
      </h2>
      {collateral.length === 0 ? (
        <p className="text-sm text-muted">—</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {collateral.map((c) => (
            <div
              key={c.id}
              className="flex gap-3 rounded-md border border-border bg-background/30 p-3"
            >
              <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-md border border-border bg-background">
                {c.photo_signed_url ? (
                  <Image
                    src={c.photo_signed_url}
                    alt=""
                    fill
                    sizes="80px"
                    unoptimized
                    className="object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted">
                    <ImageIcon size={20} />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-foreground">{c.description}</div>
                <div className="mt-1 text-xs text-muted">
                  {[
                    c.category,
                    c.metal_type,
                    c.karat ? `${c.karat}k` : null,
                    c.weight_grams ? `${c.weight_grams}g` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                <div className="mt-1 font-mono text-xs text-foreground">
                  Est. {fmtMoney(c.est_value)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function EventLogPanel({ events }: { events: LoanEventView[] }) {
  const { t } = useI18n()
  if (events.length === 0) {
    return (
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-foreground">
          {t.pawn.detail.eventLogTitle}
        </h2>
        <p className="text-sm text-muted">—</p>
      </section>
    )
  }
  return (
    <section className="rounded-lg border border-border bg-card">
      <header className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">
          {t.pawn.detail.eventLogTitle}
        </h2>
      </header>
      <ul className="divide-y divide-border">
        {events.map((e) => (
          <li key={e.id} className="px-4 py-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <EventTypeBadge type={e.event_type} />
                {e.payment_method ? (
                  <span className="rounded-full border border-border bg-background px-2 py-0.5 text-xs text-foreground">
                    {e.payment_method}
                  </span>
                ) : null}
              </div>
              <div className="font-mono text-xs text-muted">
                {new Date(e.occurred_at).toLocaleString()}
              </div>
            </div>
            <div className="mt-1 grid grid-cols-3 gap-3 text-xs">
              {e.amount != null ? (
                <span className="text-foreground">
                  {t.pawn.payment.amount}:{' '}
                  <span className="font-mono">{fmtMoney(e.amount)}</span>
                </span>
              ) : null}
              {e.principal_paid > 0 ? (
                <span className="text-foreground">
                  {t.pawn.payment.principalPaid}:{' '}
                  <span className="font-mono">{fmtMoney(e.principal_paid)}</span>
                </span>
              ) : null}
              {e.interest_paid > 0 ? (
                <span className="text-foreground">
                  {t.pawn.payment.interestPaid}:{' '}
                  <span className="font-mono">{fmtMoney(e.interest_paid)}</span>
                </span>
              ) : null}
              {e.fees_paid > 0 ? (
                <span className="text-foreground">
                  {t.pawn.payment.feesPaid}:{' '}
                  <span className="font-mono">{fmtMoney(e.fees_paid)}</span>
                </span>
              ) : null}
              {e.new_due_date ? (
                <span className="text-foreground">
                  {t.pawn.extension.newDueDate}:{' '}
                  <span className="font-mono">{e.new_due_date}</span>
                </span>
              ) : null}
            </div>
            {e.notes ? (
              <div className="mt-1 text-xs text-muted">{e.notes}</div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}

function EventTypeBadge({ type }: { type: LoanEventType }) {
  const { t } = useI18n()
  const map: Record<LoanEventType, { label: string; cls: string }> = {
    issued: {
      label: t.pawn.detail.eventIssued,
      cls: 'border-border bg-background text-foreground',
    },
    payment: {
      label: t.pawn.detail.eventPayment,
      cls: 'border-success/30 bg-success/5 text-success',
    },
    extension: {
      label: t.pawn.detail.eventExtension,
      cls: 'border-success/30 bg-success/5 text-success',
    },
    redemption: {
      label: t.pawn.detail.eventRedemption,
      cls: 'border-success/30 bg-success/5 text-success',
    },
    forfeiture: {
      label: t.pawn.detail.eventForfeiture,
      cls: 'border-warning/30 bg-warning/5 text-warning',
    },
    void: {
      label: t.pawn.detail.eventVoid,
      cls: 'border-danger/30 bg-danger/5 text-danger',
    },
  }
  const m = map[type]
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${m.cls}`}
    >
      {m.label}
    </span>
  )
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

function labelForStatus(
  s: LoanStatus,
  t: ReturnType<typeof useI18n>['t'],
): string {
  switch (s) {
    case 'active':
      return t.pawn.statusActive
    case 'extended':
      return t.pawn.statusExtended
    case 'partial_paid':
      return t.pawn.statusPartialPaid
    case 'redeemed':
      return t.pawn.statusRedeemed
    case 'forfeited':
      return t.pawn.statusForfeited
    case 'voided':
      return t.pawn.statusVoided
  }
}
