'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  CashRegister,
  CheckCircle,
  Hammer,
  Lock,
  LockOpen,
  Pause,
  Play,
  Prohibit,
  Tag,
  ThumbsUp,
  Warning,
  Wrench,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
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
import { SetQuoteDialog } from '@/components/repair/SetQuoteDialog'
import { CollectDepositDialog } from '@/components/repair/CollectDepositDialog'
import { RecordPickupDialog } from '@/components/repair/RecordPickupDialog'
import { MarkAbandonedDialog } from '@/components/repair/MarkAbandonedDialog'
import { VoidDialog } from '@/components/repair/VoidDialog'
import type { InventoryPartOption } from '@/components/repair/AddPartDialog'
import {
  addNoteAction,
  addPartAction,
  addPhotoAction,
  addStoneAction,
  approveQuoteAction,
  assignTechnicianAction,
  collectDepositAction,
  markAbandonedAction,
  markCompleteAction,
  markNeedsPartsAction,
  partsReceivedAction,
  recordPickupAction,
  removePartAction,
  removePhotoAction,
  removeStoneAction,
  requestApprovalAction,
  setPhotoCaptionAction,
  setQuoteAction,
  startTimerAction,
  startWorkAction,
  stopTimerAction,
  voidTicketAction,
  type ActionResult,
} from './actions'
import type {
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
  assigned_to: string | null
  assigned_to_name: string | null
  status: RepairStatus
  is_locked: boolean
  notes_internal: string | null
  source_inventory_item_id: string | null
  created_at: string
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

export default function RepairTicketDetail({
  ticket,
  stones,
  parts,
  photos,
  events,
  timeLogs,
  technicians,
  inventoryOptions,
  myUserId,
}: {
  ticket: RepairTicketView
  stones: RepairStoneView[]
  parts: RepairPartView[]
  photos: RepairPhotoView[]
  events: RepairEventView[]
  timeLogs: RepairTimeLogView[]
  technicians: TechnicianOption[]
  inventoryOptions: InventoryPartChoice[]
  myUserId: string | null
}) {
  const { t } = useI18n()
  const [dialog, setDialog] = useState<DialogKind>(null)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

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
    status === 'in_progress' ||
    status === 'needs_parts'
  const canRequestApproval = status === 'quoted'
  const canApproveQuote = status === 'awaiting_approval'
  const canCollectDeposit =
    !isTerminal && (status === 'awaiting_approval' || status === 'in_progress')
  const canStart =
    status === 'awaiting_approval' || status === 'needs_parts'
  const canMarkNeedsParts = status === 'in_progress'
  const canPartsReceived = status === 'needs_parts'
  const canMarkComplete = status === 'in_progress' || status === 'needs_parts'
  const canRecordPickup = status === 'ready'
  const canAbandon =
    status === 'in_progress' ||
    status === 'needs_parts' ||
    status === 'ready'
  const canVoid =
    status === 'intake' ||
    status === 'quoted' ||
    status === 'awaiting_approval' ||
    status === 'in_progress' ||
    status === 'needs_parts' ||
    status === 'ready'

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/repair"
          className="inline-flex items-center gap-1 text-sm text-ash hover:text-ink"
        >
          <ArrowLeft size={14} weight="bold" />
          {t.repair.backToList}
        </Link>
        <div className="flex items-center gap-2">
          {ticket.is_locked ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-hairline bg-cloud px-2 py-0.5 text-xs font-medium text-ink">
              <Lock size={12} weight="bold" />
              {t.repair.detail.lockedBadge}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/5 px-2 py-0.5 text-xs font-medium text-success">
              <LockOpen size={12} weight="bold" />
              {t.repair.detail.unlockedBadge}
            </span>
          )}
          <ServiceTypeBadge type={ticket.service_type} />
          <StatusBadge status={status} />
        </div>
      </div>

      {/* Header */}
      <div className="rounded-lg border border-hairline bg-canvas p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-ash">
              {t.repair.detail.ticketLabel}
            </div>
            <h1 className="font-mono text-2xl font-bold text-ink">
              {ticket.ticket_number}
            </h1>
            <div className="mt-1 text-base text-ink">{ticket.title}</div>
          </div>
          <div className="min-w-[200px]">
            <div className="text-xs uppercase tracking-wide text-ash">
              {t.repair.detail.customerLabel}
            </div>
            <Link
              href={`/customers/${ticket.customer_id}`}
              className="text-base font-semibold text-ink hover:underline"
            >
              {ticket.customer_name}
            </Link>
            <div className="text-xs text-ash">
              {[ticket.customer_phone, ticket.customer_email]
                .filter(Boolean)
                .join(' · ') || '—'}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-ash">
              {t.repair.detail.promisedLabel}
            </div>
            <div className="font-mono text-sm text-ink">
              {ticket.promised_date ?? '—'}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-ash">
              {t.repair.detail.createdLabel}
            </div>
            <div className="font-mono text-sm text-ink">
              {new Date(ticket.created_at).toLocaleDateString()}
            </div>
          </div>
        </div>
      </div>

      {/* Action row */}
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton
          label={
            canSetQuote ? t.repair.actions.setQuote : t.repair.actions.editQuote
          }
          icon={<Tag size={14} weight="bold" />}
          onClick={() => setDialog(canSetQuote ? 'setQuote' : 'editQuote')}
          disabled={isTerminal || (!canSetQuote && !canEditQuote)}
          primary={canSetQuote}
        />
        {canRequestApproval ? (
          <ActionButton
            label={t.repair.actions.requestApproval}
            icon={<Tag size={14} weight="bold" />}
            onClick={runRequestApproval}
            disabled={pending}
          />
        ) : null}
        {canApproveQuote ? (
          <ActionButton
            label={t.repair.actions.approveQuote}
            icon={<ThumbsUp size={14} weight="bold" />}
            onClick={() => runSimple(approveQuoteAction)}
            disabled={pending}
            tone="success"
          />
        ) : null}
        {canCollectDeposit ? (
          <ActionButton
            label={t.repair.actions.collectDeposit}
            icon={<CashRegister size={14} weight="bold" />}
            onClick={() => setDialog('collectDeposit')}
            disabled={pending}
          />
        ) : null}
        {canStart ? (
          <ActionButton
            label={t.repair.actions.startWork}
            icon={<Play size={14} weight="bold" />}
            onClick={() => runSimple(startWorkAction)}
            disabled={pending}
            tone="success"
          />
        ) : null}
        {canMarkNeedsParts ? (
          <ActionButton
            label={t.repair.actions.markNeedsParts}
            icon={<Pause size={14} weight="bold" />}
            onClick={() => runSimple(markNeedsPartsAction)}
            disabled={pending}
            tone="warning"
          />
        ) : null}
        {canPartsReceived ? (
          <ActionButton
            label={t.repair.actions.partsReceived}
            icon={<Hammer size={14} weight="bold" />}
            onClick={() => runSimple(partsReceivedAction)}
            disabled={pending}
            tone="success"
          />
        ) : null}
        {canMarkComplete ? (
          <ActionButton
            label={t.repair.actions.markComplete}
            icon={<CheckCircle size={14} weight="bold" />}
            onClick={() => runSimple(markCompleteAction)}
            disabled={pending}
            tone="success"
          />
        ) : null}
        {canRecordPickup ? (
          <ActionButton
            label={t.repair.actions.recordPickup}
            icon={<CheckCircle size={14} weight="bold" />}
            onClick={() => setDialog('recordPickup')}
            disabled={pending}
            primary
          />
        ) : null}
        {canAbandon ? (
          <ActionButton
            label={t.repair.actions.markAbandoned}
            icon={<Warning size={14} weight="bold" />}
            onClick={() => setDialog('markAbandoned')}
            disabled={pending}
            tone="error"
          />
        ) : null}
        {canVoid ? (
          <ActionButton
            label={t.repair.actions.void}
            icon={<Prohibit size={14} weight="bold" />}
            onClick={() => setDialog('void')}
            disabled={pending}
            tone="error"
          />
        ) : null}
      </div>

      {error ? (
        <div className="rounded-md border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">
          {readableError(error, t)}
        </div>
      ) : null}

      {/* Overview + Customer item */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <OverviewPanel ticket={ticket} />
        <ItemPanel ticket={ticket} />
        <AssignmentPanel
          ticket={ticket}
          technicians={technicians}
          disabled={ticket.is_locked}
        />
      </div>

      {/* Stones + Parts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <StonesPanel
          ticketId={ticket.id}
          stones={stones as RepairStoneItem[]}
          readOnly={ticket.is_locked}
          onAdd={(fd) => passThrough(fd, addStoneAction)}
          onRemove={(stoneId) => removeStoneAction(stoneId)}
        />
        <PartsPanel
          ticketId={ticket.id}
          parts={parts as RepairPartItem[]}
          inventoryOptions={inventoryOptions as InventoryPartOption[]}
          readOnly={ticket.is_locked}
          onAdd={(fd) => passThrough(fd, addPartAction)}
          onRemove={(partId) => removePartAction(partId)}
        />
      </div>

      {/* Photos */}
      <PhotosPanel
        ticketId={ticket.id}
        photos={photos as RepairPhotoItem[]}
        readOnly={ticket.is_locked}
        onUpload={(fd) => passThrough(fd, addPhotoAction)}
        onRemove={(photoId) => removePhotoAction(photoId)}
        onSetCaption={(fd) => passThrough(fd, setPhotoCaptionAction)}
      />

      {/* Timer + Timeline */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <TimerPanel
          ticketId={ticket.id}
          logs={timeLogs as RepairTimeLogItem[]}
          myUserId={myUserId}
          onStart={(fd) => passThrough(fd, startTimerAction)}
          onStop={(fd) => passThrough(fd, stopTimerAction)}
        />
        <TimelinePanel events={events as RepairEventItem[]} />
      </div>

      {/* Add note */}
      {!ticket.is_locked ? (
        <AddNoteForm ticketId={ticket.id} />
      ) : null}

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

function OverviewPanel({ ticket }: { ticket: RepairTicketView }) {
  const { t } = useI18n()
  return (
    <section className="rounded-lg border border-hairline bg-canvas">
      <header className="border-b border-hairline px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">
          {t.repair.detail.sectionOverview}
        </h2>
      </header>
      <dl className="grid grid-cols-2 gap-3 p-4 text-sm">
        <div>
          <dt className="text-xs text-ash">{t.repair.detail.quote}</dt>
          <dd className="font-mono text-ink">
            {ticket.quote_amount == null
              ? t.repair.detail.quotePending
              : fmtMoney(ticket.quote_amount)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ash">{t.repair.detail.deposit}</dt>
          <dd className="font-mono text-ink">{fmtMoney(ticket.deposit_amount)}</dd>
        </div>
        <div>
          <dt className="text-xs text-ash">{t.repair.detail.paid}</dt>
          <dd className="font-mono text-ink">{fmtMoney(ticket.paid_amount)}</dd>
        </div>
        <div>
          <dt className="text-xs text-ash">{t.repair.detail.balance}</dt>
          <dd className="font-mono text-ink">
            {ticket.balance_due == null ? '—' : fmtMoney(ticket.balance_due)}
          </dd>
        </div>
        {ticket.pickup_by_name ? (
          <div className="col-span-2">
            <dt className="text-xs text-ash">{t.repair.detail.pickupBy}</dt>
            <dd className="text-ink">
              {ticket.pickup_by_name}
              {ticket.picked_up_at
                ? ` · ${new Date(ticket.picked_up_at).toLocaleString()}`
                : null}
            </dd>
            {ticket.pickup_id_check ? (
              <dd className="text-xs text-ash">
                {t.repair.detail.idCheck}: {ticket.pickup_id_check}
              </dd>
            ) : null}
            {ticket.pickup_signature_signed_url ? (
              <a
                href={ticket.pickup_signature_signed_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-block text-xs text-rausch hover:underline"
              >
                {t.repair.detail.pickupSignatureView}
              </a>
            ) : null}
          </div>
        ) : null}
      </dl>
    </section>
  )
}

function ItemPanel({ ticket }: { ticket: RepairTicketView }) {
  const { t } = useI18n()
  return (
    <section className="rounded-lg border border-hairline bg-canvas">
      <header className="border-b border-hairline px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Wrench size={14} weight="regular" />
          {t.repair.detail.sectionItem}
        </h2>
      </header>
      <div className="space-y-3 p-4 text-sm">
        <div>
          <div className="text-xs text-ash">
            {t.repair.detail.itemDescription}
          </div>
          <div className="text-ink">{ticket.item_description}</div>
        </div>
        {ticket.description ? (
          <div>
            <div className="text-xs text-ash">{t.repair.detail.workNeeded}</div>
            <div className="text-ink whitespace-pre-wrap">
              {ticket.description}
            </div>
          </div>
        ) : null}
        {ticket.notes_internal ? (
          <div className="rounded-md border border-warning/20 bg-warning/5 p-2">
            <div className="text-xs text-warning">
              {t.repair.detail.notesInternalLabel}
            </div>
            <div className="text-ink whitespace-pre-wrap">
              {ticket.notes_internal}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}

function AssignmentPanel({
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
    <section className="rounded-lg border border-hairline bg-canvas">
      <header className="border-b border-hairline px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">
          {t.repair.detail.assignedTechnician}
        </h2>
      </header>
      <div className="space-y-2 p-4 text-sm">
        <select
          value={ticket.assigned_to ?? ''}
          disabled={disabled || pending}
          onChange={(e) => onChange(e.target.value)}
          className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10 disabled:opacity-50"
        >
          <option value="">{t.repair.detail.noTechnician}</option>
          {technicians.map((tech) => (
            <option key={tech.id} value={tech.id}>
              {tech.label}
            </option>
          ))}
        </select>
        {error ? <div className="text-xs text-error">{error}</div> : null}
      </div>
    </section>
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
    <section className="rounded-lg border border-hairline bg-canvas">
      <header className="border-b border-hairline px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">
          {t.repair.actions.addNote}
        </h2>
      </header>
      <div className="space-y-2 p-4">
        <textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t.repair.dialogs.addNote.notes}
          className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
        />
        <div className="flex items-center justify-end gap-2">
          {error ? (
            <span className="text-xs text-error">{error}</span>
          ) : null}
          <button
            type="button"
            onClick={submit}
            disabled={pending || !notes.trim()}
            className="rounded-md border border-hairline bg-canvas px-3 py-1.5 text-sm text-ink hover:border-ink disabled:opacity-50"
          >
            {pending ? t.common.saving : t.repair.actions.addNote}
          </button>
        </div>
      </div>
    </section>
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
      ' border-rausch bg-rausch text-canvas hover:bg-rausch-deep disabled:hover:bg-rausch'
  } else if (tone === 'success') {
    cls += ' border-success/30 bg-success/5 text-success hover:bg-success/10'
  } else if (tone === 'warning') {
    cls += ' border-warning/30 bg-warning/5 text-warning hover:bg-warning/10'
  } else if (tone === 'error') {
    cls += ' border-error/30 bg-error/5 text-error hover:bg-error/10'
  } else {
    cls += ' border-hairline bg-canvas text-ink hover:border-ink'
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cls}>
      {icon}
      {label}
    </button>
  )
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
