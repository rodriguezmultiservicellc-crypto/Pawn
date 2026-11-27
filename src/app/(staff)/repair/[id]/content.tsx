'use client'

import { useRef, useState, useTransition } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { PhotoViewer } from '@/components/uploads/PhotoViewer'
import { FOCUS, OUTLINE_BTN, PRIMARY_BTN } from '@/lib/ui/ledger'
import {
  ArrowLeft,
  CaretDown,
  CashRegister,
  ChatText,
  CheckCircle,
  ClockCounterClockwise,
  Hammer,
  Lock,
  Pause,
  Play,
  Printer,
  Prohibit,
  Tag,
  ThumbsUp,
  Warning,
  Wrench,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { daysBetween } from '@/lib/pawn/math'
import { partsCogs, repairProfit } from '@/lib/repair/billing'
import { SendReminderDialog } from '@/components/comms/SendReminderDialog'
import { manualSendAction } from '@/app/(staff)/settings/communications/actions'
import { ServiceTypeBadge } from '@/components/repair/ServiceTypeBadge'
import { StatusBadge } from '@/components/repair/StatusBadge'
import { StonesPanel, type RepairStoneItem } from '@/components/repair/StonesPanel'
import { PartsPanel, type RepairPartItem } from '@/components/repair/PartsPanel'
import { PhotosPanel, type RepairPhotoItem } from '@/components/repair/PhotosPanel'
import {
  TimelinePanel,
  type RepairEventItem,
} from '@/components/repair/TimelinePanel'
import { TimerPanel, type RepairTimeLogItem } from '@/components/repair/TimerPanel'
import { TrackingPanel } from '@/components/repair/TrackingPanel'
import { LaserOrderPanel, type LaserPanelData } from '@/components/repair/LaserOrderPanel'
import type { RepairStageLite } from '@/lib/repair/stages'
import { SetQuoteDialog } from '@/components/repair/SetQuoteDialog'
import { CollectDepositDialog } from '@/components/repair/CollectDepositDialog'
import { RecordPickupDialog } from '@/components/repair/RecordPickupDialog'
import { MarkAbandonedDialog } from '@/components/repair/MarkAbandonedDialog'
import { VoidDialog } from '@/components/repair/VoidDialog'
import PrintTagsMenu from '@/components/labels/PrintTagsMenu'
import type { TemplateChoice } from '@/lib/labels/templates'
import type { InventoryPartOption } from '@/components/repair/AddPartDialog'
import {
  addNoteAction,
  addPartAction,
  addPhotoAction,
  addStoneAction,
  approveQaAction,
  approveQuoteAction,
  assignTechnicianAction,
  claimTicketAction,
  collectDepositAction,
  markAbandonedAction,
  markCompleteAction,
  markNeedsPartsAction,
  partsReceivedAction,
  recordPickupAction,
  removePartAction,
  removePhotoAction,
  replacePhotoAction,
  removeStoneAction,
  requestApprovalAction,
  returnFromQaAction,
  sendToQaAction,
  setPhotoCaptionAction,
  setQuoteAction,
  startTimerAction,
  startWorkAction,
  stopTimerAction,
  voidTicketAction,
  type ActionResult,
} from './actions'
import type {
  InventoryCategory,
  RepairEventType,
  RepairPhotoKind,
  RepairStatus,
  ServiceType,
} from '@/types/database-aliases'

export type TechnicianOption = {
  id: string
  label: string
}

export type InventoryPartChoice = {
  id: string
  label: string
  cost_basis: number | null
  /** Narrows the Add part picker by category. */
  category: InventoryCategory
}

export type RepairTicketView = {
  id: string
  tenant_id: string
  customer_id: string
  customer_name: string
  customer_phone: string | null
  customer_email: string | null
  ticket_number: string
  service_type: ServiceType
  title: string
  description: string | null
  item_description: string
  quote_amount: number | null
  quote_set_at: string | null
  quote_approved_at: string | null
  deposit_amount: number
  deposit_collected_at: string | null
  balance_due: number | null
  paid_amount: number
  promised_date: string | null
  completed_at: string | null
  picked_up_at: string | null
  pickup_by_name: string | null
  pickup_id_check: string | null
  pickup_signature_signed_url: string | null
  pickup_signature_is_image: boolean
  assigned_to: string | null
  assigned_to_name: string | null
  status: RepairStatus
  is_locked: boolean
  notes_internal: string | null
  source_inventory_item_id: string | null
  /** Customer-facing stage pointer (patches/0061). */
  public_stage_id: string | null
  created_at: string
}

export type LaborView = {
  hours: number
  /** settings.repair_labor_rate; null = not set (labor left out). */
  rate: number | null
}

export type RepairStoneView = {
  id: string
  stone_index: number
  stone_type: string
  shape: string | null
  size_mm: number | null
  weight_carats: number | null
  color: string | null
  clarity: string | null
  mounting_type: string | null
  mounting_position: string | null
  source: 'customer_supplied' | 'shop_supplied'
  notes: string | null
}

export type RepairPartView = {
  id: string
  inventory_item_id: string | null
  description: string
  quantity: number
  unit_cost: number
  total_cost: number
  notes: string | null
}

export type RepairLineItemView = {
  id: string
  line_index: number
  title: string
  service_type: ServiceType
  work_needed: string | null
  /** The item's price, set at intake (patches/0122); null = not priced. */
  price: number | null
}

export type RepairPhotoView = {
  id: string
  storage_path: string
  signed_url: string | null
  kind: RepairPhotoKind
  caption: string | null
  position: number
}

export type RepairEventView = {
  id: string
  event_type: RepairEventType
  notes: string | null
  amount: number | null
  new_status: RepairStatus | null
  performed_by_name: string | null
  occurred_at: string
}

export type RepairTimeLogView = {
  id: string
  technician_id: string
  technician_name: string | null
  started_at: string
  stopped_at: string | null
  notes: string | null
}

type DialogKind =
  | 'setQuote'
  | 'editQuote'
  | 'collectDeposit'
  | 'startWork'
  | 'recordPickup'
  | 'markAbandoned'
  | 'void'
  | null

/** Small uppercase label; text-secondary passes 4.5:1 at 12px, muted does not. */
const LBL = 'text-[12px] font-bold uppercase tracking-wide text-text-secondary'
const CARD = 'rounded-xl border border-border bg-card'
const QUIET_BTN = `inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-sm font-bold hover:underline disabled:opacity-50 ${FOCUS}`

// ── Workflow steps (display only) ────────────────────────────────────────────
// Six steps grouped from the exact status (Eddy, 2026-11-27). The status pill
// beside the ticket number still shows the exact status. This is the
// WORKFLOW status, not the customer-facing stage (TrackingPanel).
const STEP_KEYS = ['intake', 'quoted', 'approved', 'inWork', 'ready', 'pickedUp'] as const
const STEP_OF: Record<RepairStatus, number | null> = {
  intake: 0,
  quoted: 1,
  awaiting_approval: 1,
  assigned: 2,
  in_progress: 3,
  needs_parts: 3,
  tech_qa: 3,
  ready: 4,
  picked_up: 5,
  abandoned: null,
  voided: null,
}

// ── Next step: which action is the ONE gold button per status ────────────────
// Every button still needs its own can* rule below; this only ranks them.
type ActKey =
  | 'setQuote'
  | 'editQuote'
  | 'requestApproval'
  | 'approveQuote'
  | 'collectDeposit'
  | 'startWork'
  | 'claim'
  | 'sendToQa'
  | 'approveQa'
  | 'returnFromQa'
  | 'needsParts'
  | 'partsReceived'
  | 'markComplete'
  | 'recordPickup'

const BAND: Partial<Record<RepairStatus, { gold: ActKey; rest: ActKey[] }>> = {
  intake: { gold: 'setQuote', rest: [] },
  quoted: { gold: 'requestApproval', rest: ['editQuote'] },
  awaiting_approval: {
    gold: 'approveQuote',
    rest: ['editQuote', 'collectDeposit', 'startWork'],
  },
  assigned: { gold: 'claim', rest: ['editQuote', 'collectDeposit'] },
  in_progress: { gold: 'sendToQa', rest: ['needsParts', 'markComplete', 'editQuote'] },
  needs_parts: { gold: 'partsReceived', rest: ['startWork', 'markComplete', 'editQuote'] },
  tech_qa: { gold: 'approveQa', rest: ['returnFromQa', 'editQuote'] },
  ready: { gold: 'recordPickup', rest: [] },
}

export default function RepairTicketDetail({
  ticket,
  lineItems,
  stones,
  parts,
  photos,
  events,
  timeLogs,
  labor,
  canFixClosedParts,
  technicians,
  inventoryOptions,
  myUserId,
  shopToday,
  trackingLink,
  stages,
  laser,
  tagChoices,
}: {
  ticket: RepairTicketView
  lineItems: RepairLineItemView[]
  stones: RepairStoneView[]
  parts: RepairPartView[]
  photos: RepairPhotoView[]
  events: RepairEventView[]
  timeLogs: RepairTimeLogView[]
  /** Timer hours (all sessions) and the shop's labor rate, for the P/L. */
  labor: LaborView
  /** Owner / manager: may remove a part from a closed ticket, with a reason. */
  canFixClosedParts: boolean
  technicians: TechnicianOption[]
  inventoryOptions: InventoryPartChoice[]
  myUserId: string | null
  /** Today in the shop's timezone (YYYY-MM-DD): Due today / Overdue. */
  shopToday: string
  /** Absolute /t/<token> URL, null when the link is revoked. */
  trackingLink: string | null
  /** Active customer-facing stages for this ticket's service type. */
  stages: RepairStageLite[]
  /** Laser nameplate orders for this ticket (patches/0070). */
  laser: LaserPanelData
  tagChoices: TemplateChoice[]
}) {
  const { t, lang } = useI18n()
  const td = t.repair.detail
  const ta = t.repair.actions
  const [dialog, setDialog] = useState<DialogKind>(null)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [showReminder, setShowReminder] = useState(false)
  const moreRef = useRef<HTMLDetailsElement>(null)

  function runSimple(
    action: (fd: FormData) => Promise<ActionResult>,
    extra?: Record<string, string>,
  ) {
    setError(null)
    const fd = new FormData()
    fd.set('ticket_id', ticket.id)
    if (extra) {
      for (const [k, v] of Object.entries(extra)) fd.set(k, v)
    }
    startTransition(async () => {
      const res = await action(fd)
      if (res.error) setError(res.error)
    })
  }

  function runRequestApproval() {
    setError(null)
    startTransition(async () => {
      const res = await requestApprovalAction(ticket.id)
      if (res.error) setError(res.error)
    })
  }

  async function passThrough(
    fd: FormData,
    action: (fd: FormData) => Promise<ActionResult>,
  ): Promise<ActionResult> {
    return action(fd)
  }

  // Map status to action availability.
  const status = ticket.status
  const isTerminal =
    status === 'picked_up' || status === 'abandoned' || status === 'voided'

  const canSetQuote = status === 'intake'
  const canEditQuote =
    status === 'quoted' ||
    status === 'awaiting_approval' ||
    status === 'assigned' ||
    status === 'in_progress' ||
    status === 'needs_parts' ||
    status === 'tech_qa'
  const canRequestApproval = status === 'quoted'
  const canApproveQuote = status === 'awaiting_approval'
  const canCollectDeposit =
    !isTerminal &&
    (status === 'awaiting_approval' ||
      status === 'assigned' ||
      status === 'in_progress')
  // Legacy "start work" path (operator-driven, no claim flow). Still
  // available from awaiting_approval and needs_parts so a manager who
  // skips the assignment step can keep tickets moving.
  const canStart =
    status === 'awaiting_approval' || status === 'needs_parts'
  // New tech-side actions (Phase 0023):
  //   claim:        assigned → in_progress  (auto-opens timer)
  //   sendToQa:     in_progress → tech_qa  (auto-stops timer)
  //   approveQa:    tech_qa → ready
  //   returnFromQa: tech_qa → in_progress  (auto-opens timer)
  const canClaim = status === 'assigned'
  const canSendToQa = status === 'in_progress'
  const canApproveQa = status === 'tech_qa'
  const canReturnFromQa = status === 'tech_qa'
  const canMarkNeedsParts = status === 'in_progress'
  const canPartsReceived = status === 'needs_parts'
  // Legacy "mark complete" — bypasses tech_qa. Stays available for
  // operators who want to skip the QA stage entirely.
  const canMarkComplete = status === 'in_progress' || status === 'needs_parts'
  const canRecordPickup = status === 'ready'
  const canAbandon =
    status === 'assigned' ||
    status === 'in_progress' ||
    status === 'needs_parts' ||
    status === 'tech_qa' ||
    status === 'ready'
  const canVoid =
    status === 'intake' ||
    status === 'quoted' ||
    status === 'awaiting_approval' ||
    status === 'assigned' ||
    status === 'in_progress' ||
    status === 'needs_parts' ||
    status === 'tech_qa' ||
    status === 'ready'

  // Every workflow action: its label, icon, handler and can* rule.
  const ACTS: Record<ActKey, { label: string; icon: React.ReactNode; run: () => void; can: boolean }> = {
    setQuote: {
      label: ta.setQuote,
      icon: <Tag size={16} weight="bold" />,
      run: () => setDialog('setQuote'),
      can: canSetQuote,
    },
    editQuote: {
      label: ta.editQuote,
      icon: <Tag size={16} weight="bold" />,
      run: () => setDialog('editQuote'),
      can: canEditQuote,
    },
    requestApproval: {
      label: ta.requestApproval,
      icon: <ChatText size={16} weight="bold" />,
      run: runRequestApproval,
      can: canRequestApproval,
    },
    approveQuote: {
      label: ta.approveQuote,
      icon: <ThumbsUp size={16} weight="bold" />,
      run: () => runSimple(approveQuoteAction),
      can: canApproveQuote,
    },
    collectDeposit: {
      label: ta.collectDeposit,
      icon: <CashRegister size={16} weight="bold" />,
      run: () => setDialog('collectDeposit'),
      can: canCollectDeposit,
    },
    startWork: {
      label: ta.startWork,
      icon: <Play size={16} weight="bold" />,
      run: () => runSimple(startWorkAction),
      can: canStart,
    },
    claim: {
      label: ta.claimTicket,
      icon: <Play size={16} weight="bold" />,
      run: () => runSimple(claimTicketAction),
      can: canClaim,
    },
    sendToQa: {
      label: ta.sendToQa,
      icon: <CheckCircle size={16} weight="bold" />,
      run: () => runSimple(sendToQaAction),
      can: canSendToQa,
    },
    approveQa: {
      label: ta.approveQa,
      icon: <CheckCircle size={16} weight="bold" />,
      run: () => runSimple(approveQaAction),
      can: canApproveQa,
    },
    returnFromQa: {
      label: ta.returnFromQa,
      icon: <Wrench size={16} weight="bold" />,
      run: () => runSimple(returnFromQaAction),
      can: canReturnFromQa,
    },
    needsParts: {
      label: ta.markNeedsParts,
      icon: <Pause size={16} weight="bold" />,
      run: () => runSimple(markNeedsPartsAction),
      can: canMarkNeedsParts,
    },
    partsReceived: {
      label: ta.partsReceived,
      icon: <Hammer size={16} weight="bold" />,
      run: () => runSimple(partsReceivedAction),
      can: canPartsReceived,
    },
    markComplete: {
      label: ta.markComplete,
      icon: <CheckCircle size={16} weight="bold" />,
      run: () => runSimple(markCompleteAction),
      can: canMarkComplete,
    },
    recordPickup: {
      label: ta.recordPickup,
      icon: <CheckCircle size={16} weight="bold" />,
      run: () => setDialog('recordPickup'),
      can: canRecordPickup,
    },
  }

  const band = isTerminal ? null : BAND[status] ?? null
  const bandSentence =
    band && status in td.nextStep
      ? td.nextStep[status as keyof typeof td.nextStep].replace(
          '{amount}',
          fmtMoney(ticket.quote_amount ?? 0),
        )
      : null

  // Promised: date + how it stands against the SHOP's today.
  const locale = lang === 'es' ? 'es-US' : 'en-US'
  const lateBy = ticket.promised_date ? daysBetween(ticket.promised_date, shopToday) : null
  const promisedNote =
    isTerminal || lateBy == null
      ? null
      : lateBy === 0
      ? { text: td.dueToday, tone: 'text-warning' }
      : lateBy > 0 && status !== 'ready'
      ? {
          text: lateBy === 1 ? td.overdueOne : td.overdueDays.replace('{n}', String(lateBy)),
          tone: 'text-danger',
        }
      : null

  const currentStep = STEP_OF[status]

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4">
      {/* ── Top row ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/repair"
          className="inline-flex items-center gap-1 text-sm font-semibold text-blue hover:underline"
        >
          <ArrowLeft size={14} weight="bold" />
          {t.repair.backToList}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`/api/print/repair/${ticket.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className={OUTLINE_BTN}
          >
            <Printer size={16} weight="bold" />
            {t.repair.print.button}
          </a>
          {ticket.ticket_number ? (
            <PrintTagsMenu
              kind="repair"
              target={{ ticket: ticket.id }}
              choices={tagChoices}
              label={t.tags.printRepair}
            />
          ) : null}
          <button type="button" onClick={() => setShowReminder(true)} className={OUTLINE_BTN}>
            {t.comms.sendReminderButton}
          </button>
          {canAbandon ? (
            <details ref={moreRef} className="relative">
              <summary className={`${OUTLINE_BTN} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
                {td.moreActions}
                <CaretDown size={14} weight="bold" />
              </summary>
              <div className="absolute right-0 top-full z-30 mt-1 min-w-48 rounded-xl border border-border bg-card p-1 shadow-lg">
                <button
                  type="button"
                  onClick={() => {
                    if (moreRef.current) moreRef.current.open = false
                    setDialog('markAbandoned')
                  }}
                  disabled={pending}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-danger hover:bg-background ${FOCUS}`}
                >
                  <Warning size={16} weight="bold" />
                  {ta.markAbandoned}
                </button>
              </div>
            </details>
          ) : null}
        </div>
      </div>
      {showReminder ? (
        <SendReminderDialog
          customerId={ticket.customer_id}
          customerName={ticket.customer_name}
          allowedKinds={['repair_ready', 'repair_pickup_reminder', 'custom']}
          defaultKind={
            ticket.status === 'ready' ? 'repair_ready' : 'repair_pickup_reminder'
          }
          related={{ repairTicketId: ticket.id }}
          onClose={() => setShowReminder(false)}
          action={manualSendAction}
        />
      ) : null}

      {/* ── Ticket header ─────────────────────────────────────────────── */}
      <section className={`${CARD} overflow-hidden`}>
        <div className="flex flex-wrap items-start gap-x-8 gap-y-4 px-5 py-4">
          <div className="min-w-0 flex-[2_1_300px]">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-mono text-[28px] font-bold leading-tight tracking-tight text-foreground">
                {ticket.ticket_number}
              </h1>
              <StatusBadge status={status} />
              <ServiceTypeBadge type={ticket.service_type} />
              {ticket.is_locked ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-xs font-semibold text-text-secondary">
                  <Lock size={12} weight="bold" />
                  {td.lockedBadge}
                </span>
              ) : null}
            </div>
            <div className="mt-1.5 text-[17px] font-semibold text-foreground">{ticket.title}</div>
          </div>
          <div className="min-w-0 flex-[1_1_220px]">
            <div className={LBL}>{td.customerLabel}</div>
            <Link
              href={`/customers/${ticket.customer_id}`}
              className="mt-1 block text-base font-bold text-foreground hover:text-blue hover:underline"
            >
              {ticket.customer_name}
            </Link>
            {ticket.customer_phone ? (
              <a
                href={`tel:${ticket.customer_phone.replace(/[^\d+]/g, '')}`}
                className="block text-sm text-blue hover:underline"
              >
                {ticket.customer_phone}
              </a>
            ) : null}
            {ticket.customer_email ? (
              <div className="truncate text-sm text-text-secondary">{ticket.customer_email}</div>
            ) : null}
          </div>
          <div className="flex-[0_1_170px]">
            <div className={LBL}>{td.promisedLabel}</div>
            <div className="mt-1 text-base font-bold text-foreground">
              {ticket.promised_date ? fmtDay(ticket.promised_date, locale) : '—'}
            </div>
            {promisedNote ? (
              <div className={`text-sm font-bold ${promisedNote.tone}`}>{promisedNote.text}</div>
            ) : null}
          </div>
          <div className="flex-[0_1_130px]">
            <div className={LBL}>{td.createdLabel}</div>
            <div className="mt-1 text-base text-text-secondary">
              {new Date(ticket.created_at).toLocaleDateString(locale, {
                month: 'short',
                day: 'numeric',
                year: ticket.created_at.slice(0, 4) === shopToday.slice(0, 4) ? undefined : 'numeric',
              })}
            </div>
          </div>
        </div>

        {/* Workflow steps — display only. */}
        <ol aria-label={td.stepsLabel} className="grid grid-cols-6 gap-1.5 px-5 pb-4">
          {STEP_KEYS.map((key, i) => {
            const done =
              currentStep != null && (i < currentStep || (status === 'picked_up' && i === currentStep))
            const current = currentStep === i && status !== 'picked_up'
            return (
              <li key={key} aria-current={current ? 'step' : undefined}>
                <div
                  className={`h-1.5 rounded-full ${done ? 'bg-blue' : current ? 'bg-gold' : 'bg-border'}`}
                />
                <div
                  className={`mt-1.5 hidden truncate text-[13px] sm:block ${
                    current
                      ? 'font-bold text-foreground'
                      : done
                      ? 'font-semibold text-text-secondary'
                      : 'text-text-secondary'
                  }`}
                >
                  {td.steps[key]}
                </div>
              </li>
            )
          })}
        </ol>
        {/* A phone has no room for six names: the current one only. */}
        {currentStep != null && status !== 'picked_up' ? (
          <p className="-mt-2 px-5 pb-4 text-[13px] font-bold text-foreground sm:hidden">
            {td.steps[STEP_KEYS[currentStep]]}
          </p>
        ) : null}

        {/* Next step: one sentence + the ONE gold button for this status. */}
        {band ? (
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-gold/30 bg-gold/5 px-5 py-3.5">
            <div className="min-w-0">
              <div className="text-[12px] font-bold uppercase tracking-wide text-foreground">
                {td.nextStepLabel}
              </div>
              {bandSentence ? (
                <div className="mt-0.5 text-base font-semibold text-foreground">{bandSentence}</div>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {band.rest
                .filter((k) => ACTS[k].can)
                .map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={ACTS[k].run}
                    disabled={pending}
                    className={OUTLINE_BTN}
                  >
                    {ACTS[k].icon}
                    {ACTS[k].label}
                  </button>
                ))}
              {ACTS[band.gold].can ? (
                <button
                  type="button"
                  onClick={ACTS[band.gold].run}
                  disabled={pending}
                  className={`${PRIMARY_BTN} h-11 text-sm`}
                >
                  {ACTS[band.gold].icon}
                  {ACTS[band.gold].label}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        {error ? (
          <div
            role="alert"
            className="border-t border-danger/30 bg-danger/5 px-5 py-2.5 text-sm text-danger"
          >
            {readableError(error, t)}
          </div>
        ) : null}
      </section>

      {/* ── Two columns: the work | money, tech, customer link ──────────── */}
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-4">
          <ItemAndWork>
            <PhotosPanel
              ticketId={ticket.id}
              photos={photos as RepairPhotoItem[]}
              readOnly={ticket.is_locked}
              onUpload={(fd) => passThrough(fd, addPhotoAction)}
              onRemove={(photoId) => removePhotoAction(photoId)}
              onReplace={(fd) => passThrough(fd, replacePhotoAction)}
              onSetCaption={(fd) => passThrough(fd, setPhotoCaptionAction)}
              aside={<ItemLines ticket={ticket} lineItems={lineItems} />}
              extras={
                <StonesPanel
                  ticketId={ticket.id}
                  stones={stones as RepairStoneItem[]}
                  readOnly={ticket.is_locked}
                  onAdd={(fd) => passThrough(fd, addStoneAction)}
                  onRemove={(stoneId) => removeStoneAction(stoneId)}
                />
              }
            />
          </ItemAndWork>

          <PartsPanel
            ticketId={ticket.id}
            parts={parts as RepairPartItem[]}
            inventoryOptions={inventoryOptions as InventoryPartOption[]}
            quoteAmount={ticket.quote_amount}
            readOnly={ticket.is_locked}
            closedFix={ticket.is_locked && canFixClosedParts}
            onAdd={(fd) => passThrough(fd, addPartAction)}
            onRemove={(partId, reason) => removePartAction(partId, reason)}
          />

          <section className={CARD}>
            <header className="border-b border-border px-4 py-3">
              <h2 className="flex items-center gap-2 text-base font-bold text-foreground">
                <ClockCounterClockwise size={16} weight="regular" />
                {td.sectionNotesActivity}
              </h2>
            </header>
            <div className="px-4 pb-1 pt-3">
              {!ticket.is_locked ? <AddNoteForm ticketId={ticket.id} /> : null}
              <TimelinePanel events={events as RepairEventItem[]} />
            </div>
          </section>
        </div>

        <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-4">
          <MoneyCard
            ticket={ticket}
            partsCost={partsCogs(parts)}
            labor={labor}
            canSetLaborRate={canFixClosedParts}
            canCollectDeposit={canCollectDeposit}
            pending={pending}
            onCollectDeposit={() => setDialog('collectDeposit')}
          />

          <section className={`${CARD} space-y-4 px-4 py-4`}>
            <AssignmentSelect
              ticket={ticket}
              technicians={technicians}
              disabled={ticket.is_locked}
            />
            <div className="border-t border-border pt-4">
              <TimerPanel
                ticketId={ticket.id}
                logs={timeLogs as RepairTimeLogItem[]}
                myUserId={myUserId}
                onStart={(fd) => passThrough(fd, startTimerAction)}
                onStop={(fd) => passThrough(fd, stopTimerAction)}
              />
            </div>
          </section>

          {/* Customer tracking link + customer-facing stage (patches/0061) */}
          <TrackingPanel
            ticketId={ticket.id}
            link={trackingLink}
            stages={stages}
            currentStageId={ticket.public_stage_id}
            isTerminal={isTerminal}
          />

          {/* Send to laser — nameplate orders through orocut.com (patches/0070) */}
          <LaserOrderPanel
            ticketId={ticket.id}
            customerName={ticket.customer_name}
            promisedDate={ticket.promised_date}
            isTerminal={isTerminal}
            data={laser}
          />

          {canVoid ? (
            <button
              type="button"
              onClick={() => setDialog('void')}
              disabled={pending}
              className={`${QUIET_BTN} self-start text-danger`}
            >
              <Prohibit size={16} weight="bold" />
              {td.voidTicket}
            </button>
          ) : null}
        </div>
      </div>

      {/* Dialogs */}
      {dialog === 'setQuote' || dialog === 'editQuote' ? (
        <SetQuoteDialog
          ticketId={ticket.id}
          initialAmount={ticket.quote_amount}
          onClose={() => setDialog(null)}
          onSubmit={(fd) => passThrough(fd, setQuoteAction)}
        />
      ) : null}
      {dialog === 'collectDeposit' ? (
        <CollectDepositDialog
          ticketId={ticket.id}
          onClose={() => setDialog(null)}
          onSubmit={(fd) => passThrough(fd, collectDepositAction)}
        />
      ) : null}
      {dialog === 'recordPickup' ? (
        <RecordPickupDialog
          ticketId={ticket.id}
          balanceDue={ticket.balance_due}
          onClose={() => setDialog(null)}
          onSubmit={(fd) => passThrough(fd, recordPickupAction)}
        />
      ) : null}
      {dialog === 'markAbandoned' ? (
        <MarkAbandonedDialog
          ticketId={ticket.id}
          onClose={() => setDialog(null)}
          onSubmit={(fd) => passThrough(fd, markAbandonedAction)}
        />
      ) : null}
      {dialog === 'void' ? (
        <VoidDialog
          ticketId={ticket.id}
          onClose={() => setDialog(null)}
          onSubmit={(fd) => passThrough(fd, voidTicketAction)}
        />
      ) : null}
    </div>
  )
}

/** Balance due large, then Quote / Deposit / Paid; pickup record when done. */
function MoneyCard({
  ticket,
  partsCost,
  labor,
  canSetLaborRate,
  canCollectDeposit,
  pending,
  onCollectDeposit,
}: {
  ticket: RepairTicketView
  partsCost: number
  labor: LaborView
  canSetLaborRate: boolean
  canCollectDeposit: boolean
  pending: boolean
  onCollectDeposit: () => void
}) {
  // The pickup signature, big, view only: it is the customer's record of
  // taking the piece home, never changed.
  const [viewingSignature, setViewingSignature] = useState(false)
  const { t } = useI18n()
  const td = t.repair.detail
  const row = 'flex items-center justify-between gap-3 text-sm text-text-secondary'
  return (
    <section className={`${CARD} px-4 py-4`}>
      <div className={LBL}>{td.balance}</div>
      <div className="font-mono text-[34px] font-bold leading-tight tabular-nums text-foreground">
        {ticket.balance_due == null ? '—' : fmtMoney(ticket.balance_due)}
      </div>
      <dl className="mt-2.5 space-y-1.5">
        <div className={row}>
          <dt>{td.quote}</dt>
          <dd className="font-mono text-foreground">
            {ticket.quote_amount == null ? td.quotePending : fmtMoney(ticket.quote_amount)}
          </dd>
        </div>
        <div className={row}>
          <dt>{td.deposit}</dt>
          <dd className="font-mono text-foreground">{fmtMoney(ticket.deposit_amount)}</dd>
        </div>
        <div className={row}>
          <dt>{td.paid}</dt>
          <dd className="font-mono text-foreground">{fmtMoney(ticket.paid_amount)}</dd>
        </div>
      </dl>
      <ProfitBlock
        ticket={ticket}
        partsCost={partsCost}
        labor={labor}
        canSetLaborRate={canSetLaborRate}
      />
      {canCollectDeposit ? (
        <button
          type="button"
          onClick={onCollectDeposit}
          disabled={pending}
          className={`${OUTLINE_BTN} mt-3.5 w-full`}
        >
          <CashRegister size={16} weight="bold" />
          {t.repair.actions.collectDeposit}
        </button>
      ) : null}
      {ticket.pickup_by_name ? (
        <div className="mt-4 border-t border-border pt-3 text-sm">
          <div className={LBL}>{td.pickupBy}</div>
          <div className="mt-0.5 text-foreground">
            {ticket.pickup_by_name}
            {ticket.picked_up_at
              ? ` · ${new Date(ticket.picked_up_at).toLocaleString()}`
              : null}
          </div>
          {ticket.pickup_id_check ? (
            <div className="text-xs text-text-secondary">
              {td.idCheck}: {ticket.pickup_id_check}
            </div>
          ) : null}
          {ticket.pickup_signature_signed_url && ticket.pickup_signature_is_image ? (
            <div className="mt-1">
              <button
                type="button"
                onClick={() => setViewingSignature(true)}
                title={td.pickupSignatureView}
                aria-label={td.pickupSignatureView}
                className={`relative block h-16 w-40 cursor-zoom-in overflow-hidden rounded-md border border-border bg-white ${FOCUS}`}
              >
                <Image
                  src={ticket.pickup_signature_signed_url}
                  alt=""
                  fill
                  sizes="160px"
                  unoptimized
                  className="object-contain"
                />
              </button>
              <PhotoViewer
                photos={[
                  {
                    path: ticket.pickup_signature_signed_url,
                    url: ticket.pickup_signature_signed_url,
                    name: td.pickupSignatureView,
                  },
                ]}
                index={viewingSignature ? 0 : null}
                onIndex={(i) => setViewingSignature(i != null)}
                noMain
              />
            </div>
          ) : ticket.pickup_signature_signed_url ? (
            <a
              href={ticket.pickup_signature_signed_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-block text-xs text-blue hover:underline"
            >
              {td.pickupSignatureView}
            </a>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

/** The "Item and work" card. Its body is the photo block, which lays the
 *  item lines beside the thumbnails (PhotosPanel `aside`). */
function ItemAndWork({ children }: { children: React.ReactNode }) {
  const { t } = useI18n()
  return (
    <section className={CARD}>
      <header className="border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-base font-bold text-foreground">
          <Wrench size={16} weight="regular" />
          {t.repair.detail.sectionItemAndWork}
        </h2>
      </header>
      <div className="px-4 py-4">{children}</div>
    </section>
  )
}

/** The item line(s): title, work, service type, price; internal notes. */
function ItemLines({
  ticket,
  lineItems,
}: {
  ticket: RepairTicketView
  lineItems: RepairLineItemView[]
}) {
  const { t } = useI18n()
  const td = t.repair.detail
  // The header already shows the title: one item whose title IS the ticket
  // title prints only its work, price and service.
  const single = lineItems.length === 1 && lineItems[0].title.trim() === ticket.title.trim()
  return (
    <div className="space-y-3">
      {lineItems.length > 0 ? (
        <ul className="space-y-3">
          {lineItems.map((li) => (
            <li key={li.id} className="border-b border-border pb-3 last:border-b-0 last:pb-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {!single ? (
                    <div className="text-base font-bold text-foreground">{li.title}</div>
                  ) : null}
                  {li.work_needed ? (
                    <div className="whitespace-pre-wrap text-base text-foreground">
                      {li.work_needed}
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <ServiceTypeBadge type={li.service_type} />
                  {li.price != null ? (
                    <span className="font-mono text-base font-bold tabular-nums text-foreground">
                      {fmtMoney(li.price)}
                    </span>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        // Legacy tickets (no line items backfilled): the free-text snapshot.
        <div>
          <div className={LBL}>{td.itemDescription}</div>
          <div className="whitespace-pre-wrap text-foreground">{ticket.item_description}</div>
        </div>
      )}
      {ticket.notes_internal ? (
        <div className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-sm">
          <div className="text-xs font-bold text-warning">{td.notesInternalLabel}</div>
          <div className="whitespace-pre-wrap text-foreground">{ticket.notes_internal}</div>
        </div>
      ) : null}
    </div>
  )
}

function AssignmentSelect({
  ticket,
  technicians,
  disabled,
}: {
  ticket: RepairTicketView
  technicians: TechnicianOption[]
  disabled?: boolean
}) {
  const { t } = useI18n()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function onChange(value: string) {
    setError(null)
    const fd = new FormData()
    fd.set('ticket_id', ticket.id)
    if (value) fd.set('assigned_to', value)
    startTransition(async () => {
      const res = await assignTechnicianAction(fd)
      if (res.error) setError(res.error)
    })
  }

  return (
    <div>
      <label htmlFor="repair-technician" className={`${LBL} block`}>
        {t.repair.detail.assignedTechnician}
      </label>
      <select
        id="repair-technician"
        value={ticket.assigned_to ?? ''}
        disabled={disabled || pending}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-1.5 block h-11 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-blue disabled:opacity-50 ${FOCUS}`}
      >
        <option value="">{t.repair.detail.noTechnician}</option>
        {technicians.map((tech) => (
          <option key={tech.id} value={tech.id}>
            {tech.label}
          </option>
        ))}
      </select>
      {error ? <div className="mt-1 text-xs text-danger">{error}</div> : null}
    </div>
  )
}

function AddNoteForm({ ticketId }: { ticketId: string }) {
  const { t } = useI18n()
  const [pending, startTransition] = useTransition()
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  function submit() {
    if (!notes.trim()) return
    setError(null)
    const fd = new FormData()
    fd.set('ticket_id', ticketId)
    fd.set('notes', notes)
    startTransition(async () => {
      const res = await addNoteAction(fd)
      if (res.error) setError(res.error)
      else setNotes('')
    })
  }

  return (
    <div className="pb-3">
      <div className="flex flex-wrap gap-2">
        <label htmlFor="repair-add-note" className="sr-only">
          {t.repair.actions.addNote}
        </label>
        <input
          id="repair-add-note"
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
          }}
          placeholder={t.repair.detail.notePlaceholder}
          className={`h-11 min-w-0 flex-[1_1_260px] rounded-md border border-border bg-card px-3 text-[15px] text-foreground outline-none focus:border-blue ${FOCUS}`}
        />
        <button
          type="button"
          onClick={submit}
          disabled={pending || !notes.trim()}
          className={OUTLINE_BTN}
        >
          {pending ? t.common.saving : t.repair.actions.addNote}
        </button>
      </div>
      {error ? <div className="mt-1 text-xs text-danger">{error}</div> : null}
    </div>
  )
}

/** A promised date (YYYY-MM-DD) as "Fri, Nov 27" — the calendar day itself,
 *  never shifted by the browser's timezone. */
function fmtDay(ymd: string, locale: string): string {
  const d = new Date(`${ymd}T12:00:00Z`)
  if (isNaN(d.getTime())) return ymd
  return d.toLocaleDateString(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/**
 * Profit / loss of this job: money in (closed) or the quote (open) less the
 * parts and the labor (timer hours x the shop's rate, when one is set).
 */
function ProfitBlock({
  ticket,
  partsCost,
  labor,
  canSetLaborRate,
}: {
  ticket: RepairTicketView
  partsCost: number
  labor: LaborView
  canSetLaborRate: boolean
}) {
  const { t } = useI18n()
  const td = t.repair.detail
  const p = repairProfit({
    quote: ticket.quote_amount,
    deposit: ticket.deposit_amount,
    paid: ticket.paid_amount,
    partsCost,
    laborHours: labor.hours,
    laborRate: labor.rate,
    closed: ticket.is_locked,
  })
  const row = 'flex items-center justify-between gap-3 text-sm text-text-secondary'
  const tone = p.profit < 0 ? 'text-danger' : 'text-success'
  return (
    <div className="mt-4 border-t border-border pt-3">
      <div className={LBL}>{td.profitTitle}</div>
      <dl className="mt-2 space-y-1.5">
        <div className={row}>
          <dt>{p.final || ticket.quote_amount == null ? td.profitMoneyIn : td.profitQuote}</dt>
          <dd className="font-mono text-foreground">{fmtMoney(p.revenue)}</dd>
        </div>
        <div className={row}>
          <dt>{td.profitParts}</dt>
          <dd className="font-mono text-foreground">{fmtCost(p.partsCost)}</dd>
        </div>
        {p.laborCost != null && labor.rate != null ? (
          <div className={row}>
            <dt>
              {td.profitLabor
                .replace('{hours}', labor.hours.toFixed(2))
                .replace('{rate}', fmtMoney(labor.rate))}
            </dt>
            <dd className="font-mono text-foreground">{fmtCost(p.laborCost)}</dd>
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-3 border-t border-border pt-1.5 text-sm font-bold text-foreground">
          <dt>{p.final ? td.profit : td.profitExpected}</dt>
          <dd className={`font-mono ${tone}`}>
            {p.profit < 0 ? '−' : ''}
            {fmtMoney(Math.abs(p.profit))}
            {p.margin != null ? (
              <span className="ml-1.5 text-xs font-semibold">
                ({Math.round(p.margin * 100)}%)
              </span>
            ) : null}
          </dd>
        </div>
      </dl>
      <p className="mt-1.5 text-xs text-text-secondary">
        {p.final ? td.profitNoteClosed : td.profitNoteOpen}{' '}
        {p.laborCost == null ? (
          canSetLaborRate ? (
            <Link href="/settings/repair-stages" className="text-blue hover:underline">
              {td.profitNoLaborRateLink}
            </Link>
          ) : (
            td.profitNoLaborRate
          )
        ) : null}
      </p>
    </div>
  )
}

/** A cost taken off: "−$12.50", and plain "$0.00" when there is none. */
function fmtCost(v: number): string {
  return v > 0 ? `−${fmtMoney(v)}` : fmtMoney(0)
}

function fmtMoney(v: number): string {
  if (!isFinite(v)) return '—'
  return v.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  })
}

function readableError(
  err: string,
  t: ReturnType<typeof useI18n>['t'],
): string {
  switch (err) {
    case 'illegalTransition':
      return t.repair.errors.illegalTransition
    case 'customer_locked':
    case 'customerLocked':
      return t.repair.errors.customerLocked
    case 'mimeNotAllowed':
      return t.repair.errors.mimeNotAllowed
    case 'tooLarge':
      return t.repair.errors.tooLarge
    case 'validation_failed':
    case 'validationFailed':
      return t.repair.errors.validationFailed
    case 'timerAlreadyRunning':
      return t.repair.errors.timerAlreadyRunning
    case 'timerNotFound':
      return t.repair.errors.timerNotFound
    case 'notAuthorized':
      return t.repair.errors.notAuthorized
    default:
      return err
  }
}
