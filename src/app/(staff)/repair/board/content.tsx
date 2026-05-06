'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, User, Warning } from '@phosphor-icons/react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { useI18n } from '@/lib/i18n/context'
import { daysBetween } from '@/lib/pawn/math'
import { ServiceTypeBadge } from '@/components/repair/ServiceTypeBadge'
import { StatusBadge } from '@/components/repair/StatusBadge'
import { canTransition } from '@/lib/repair/workflow'
import { moveTicketStatusAction } from './actions'
import type { RepairStatus, ServiceType } from '@/types/database-aliases'

export type TechOption = {
  id: string
  name: string
  activeCount: number
}

export type BoardCard = {
  id: string
  ticket_number: string
  customer_name: string
  service_type: ServiceType
  title: string
  promised_date: string | null
  status: RepairStatus
  assigned_to: string | null
  assigned_to_name: string | null
  balance_due: number | null
  created_at: string
}

type BoardCardMap = Record<RepairStatus, BoardCard[]>

export default function BoardContent({
  columns,
  cardsByStatus,
  techOptions,
  techFilter,
  unassignedCount,
  serviceTypeFilter,
  today,
}: {
  columns: ReadonlyArray<RepairStatus>
  cardsByStatus: BoardCardMap
  techOptions: TechOption[]
  techFilter: string
  unassignedCount: number
  serviceTypeFilter: string
  today: string
}) {
  const { t } = useI18n()
  const router = useRouter()
  const sp = useSearchParams()
  const [pending, startTransition] = useTransition()

  // Local card map so optimistic moves render before the server action
  // round-trips. Reset when the parent prop changes (route refresh).
  const [localCards, setLocalCards] = useState<BoardCardMap>(cardsByStatus)
  const [propsSnapshot, setPropsSnapshot] = useState(cardsByStatus)
  if (cardsByStatus !== propsSnapshot) {
    setPropsSnapshot(cardsByStatus)
    setLocalCards(cardsByStatus)
  }

  const [activeCard, setActiveCard] = useState<BoardCard | null>(null)
  const [moveError, setMoveError] = useState<string | null>(null)
  const [movePending, startMoveTransition] = useTransition()

  // PointerSensor with an 8px activation distance keeps clicks (which
  // navigate to the detail page) fast — only intentional drags trigger
  // DnD. KeyboardSensor preserves accessibility for users who can't /
  // don't drag.
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor),
  )

  function pushParams(next: Record<string, string | null>) {
    const usp = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(next)) {
      if (v == null || v === '') usp.delete(k)
      else usp.set(k, v)
    }
    startTransition(() => {
      router.push(`/repair/board${usp.toString() ? `?${usp.toString()}` : ''}`)
    })
  }

  const totalCards = columns.reduce(
    (sum, status) => sum + localCards[status].length,
    0,
  )

  function handleDragStart(e: DragStartEvent) {
    const id = String(e.active.id)
    for (const col of columns) {
      const found = localCards[col].find((c) => c.id === id)
      if (found) {
        setActiveCard(found)
        setMoveError(null)
        return
      }
    }
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveCard(null)
    if (!e.over) return
    const cardId = String(e.active.id)
    const toStatus = String(e.over.id) as RepairStatus

    // Locate the card + its current status in the local map.
    let fromStatus: RepairStatus | null = null
    let card: BoardCard | null = null
    for (const col of columns) {
      const idx = localCards[col].findIndex((c) => c.id === cardId)
      if (idx >= 0) {
        fromStatus = col
        card = localCards[col][idx]
        break
      }
    }
    if (!fromStatus || !card) return
    if (fromStatus === toStatus) return

    // Client-side guard: same canTransition() the server uses. Bouncing
    // illegal drops here keeps the UX snappy without a round-trip.
    if (!canTransition(fromStatus, toStatus)) {
      setMoveError(t.repair.board.moveIllegal)
      return
    }

    // Optimistic update: snapshot, mutate, dispatch.
    const snapshot = localCards
    const optimistic: BoardCardMap = { ...localCards }
    optimistic[fromStatus] = localCards[fromStatus].filter(
      (c) => c.id !== cardId,
    )
    optimistic[toStatus] = [
      ...localCards[toStatus],
      { ...card, status: toStatus },
    ]
    setLocalCards(optimistic)

    const fd = new FormData()
    fd.set('ticket_id', cardId)
    fd.set('to_status', toStatus)
    startMoveTransition(async () => {
      const res = await moveTicketStatusAction(fd)
      if (!res.ok) {
        // Revert and surface the error.
        setLocalCards(snapshot)
        setMoveError(
          res.error === 'illegalTransition'
            ? t.repair.board.moveIllegal
            : t.repair.board.moveFailed,
        )
      } else {
        // Refresh server state so derived views (timer state, audit log,
        // counts) reflect the move on the next render.
        router.refresh()
      }
    })
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveCard(null)}
    >
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Link
              href="/repair"
              className="mb-1 inline-flex items-center gap-1 text-xs text-muted hover:text-foreground"
            >
              <ArrowLeft size={12} weight="bold" />
              {t.repair.board.backToList}
            </Link>
            <h1 className="font-display text-2xl font-bold">{t.repair.board.title}</h1>
            <p className="text-sm text-muted">{t.repair.board.subtitle}</p>
          </div>
          <div className="text-right">
            <div className="font-mono text-2xl font-semibold text-foreground">
              {totalCards}
            </div>
            <div className="text-[11px] text-muted">{t.repair.board.totalActive}</div>
          </div>
        </div>

        {moveError ? (
          <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
            <Warning size={14} weight="bold" />
            <span>{moveError}</span>
          </div>
        ) : null}

        {/* Tech chip strip */}
        <div className="flex flex-wrap gap-2">
          <TechChip
            label={t.repair.board.techAll}
            count={null}
            active={techFilter === ''}
            onClick={() => pushParams({ tech: null })}
          />
          <TechChip
            label={t.repair.board.techUnassigned}
            count={unassignedCount}
            active={techFilter === 'unassigned'}
            tone="warning"
            onClick={() => pushParams({ tech: 'unassigned' })}
          />
          {techOptions.map((tech) => (
            <TechChip
              key={tech.id}
              label={tech.name}
              count={tech.activeCount}
              active={techFilter === tech.id}
              onClick={() => pushParams({ tech: tech.id })}
            />
          ))}
        </div>

        {/* Service type filter */}
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted">
            {t.repair.list.serviceType}:
          </label>
          <select
            value={serviceTypeFilter}
            onChange={(e) => pushParams({ serviceType: e.target.value })}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
          >
            <option value="">{t.common.all}</option>
            <option value="repair">{t.repair.serviceTypes.repair}</option>
            <option value="stone_setting">{t.repair.serviceTypes.stoneSetting}</option>
            <option value="sizing">{t.repair.serviceTypes.sizing}</option>
            <option value="restring">{t.repair.serviceTypes.restring}</option>
            <option value="plating">{t.repair.serviceTypes.plating}</option>
            <option value="engraving">{t.repair.serviceTypes.engraving}</option>
            <option value="custom">{t.repair.serviceTypes.custom}</option>
          </select>
          {pending || movePending ? (
            <span className="text-[11px] text-muted">
              {movePending ? t.repair.board.moveSaving : t.common.loading}
            </span>
          ) : null}
        </div>

        {/* Columns */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {columns.map((status) => (
            <Column
              key={status}
              status={status}
              cards={localCards[status]}
              today={today}
              activeCardStatus={activeCard?.status ?? null}
              onCardClick={(id) => router.push(`/repair/${id}`)}
            />
          ))}
        </div>
      </div>

      <DragOverlay>
        {activeCard ? (
          <div className="cursor-grabbing">
            <CardBody card={activeCard} today={today} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

function Column({
  status,
  cards,
  today,
  activeCardStatus,
  onCardClick,
}: {
  status: RepairStatus
  cards: BoardCard[]
  today: string
  activeCardStatus: RepairStatus | null
  onCardClick: (id: string) => void
}) {
  const { t } = useI18n()
  const { isOver, setNodeRef } = useDroppable({ id: status })

  // Visual hint: tint the column when a drag is in progress AND the move
  // would be a legal transition. Same canTransition() the server uses.
  const isLegalTarget =
    activeCardStatus != null &&
    activeCardStatus !== status &&
    canTransition(activeCardStatus, status)
  const isIllegalTarget =
    activeCardStatus != null &&
    activeCardStatus !== status &&
    !canTransition(activeCardStatus, status)

  const dropClass = isOver
    ? isLegalTarget
      ? 'border-success bg-success/5'
      : 'border-danger bg-danger/5'
    : isLegalTarget
      ? 'border-success/40'
      : isIllegalTarget
        ? 'opacity-50'
        : 'border-border'

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col rounded-lg border bg-background/40 transition-colors ${dropClass}`}
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <StatusBadge status={status} />
        <span className="font-mono text-xs text-muted">{cards.length}</span>
      </div>
      <div className="flex flex-col gap-2 p-2 min-h-[3rem]">
        {cards.length === 0 ? (
          <div className="px-2 py-6 text-center text-[11px] text-muted">
            {t.repair.board.columnEmpty}
          </div>
        ) : (
          cards.map((card) => (
            <DraggableCard
              key={card.id}
              card={card}
              today={today}
              onClick={() => onCardClick(card.id)}
            />
          ))
        )}
      </div>
    </div>
  )
}

function DraggableCard({
  card,
  today,
  onClick,
}: {
  card: BoardCard
  today: string
  onClick: () => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: card.id,
  })
  // PointerSensor's 8px activationConstraint means pointer-down→up without
  // movement passes through as a native click; only intentional drags
  // cross the threshold and consume the gesture. Render as a button so
  // keyboard activation (Enter/Space when the keyboard sensor isn't
  // dragging) still navigates.
  return (
    <button
      type="button"
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={`block w-full text-left cursor-grab transition-opacity ${
        isDragging ? 'opacity-30' : ''
      }`}
    >
      <CardBody card={card} today={today} />
    </button>
  )
}

function CardBody({ card, today }: { card: BoardCard; today: string }) {
  const { t } = useI18n()
  const days =
    card.promised_date != null ? daysBetween(today, card.promised_date) : null
  const isOverdue = days != null && days < 0
  const isDueSoon = days != null && days >= 0 && days <= 7

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border bg-card p-2.5 text-left transition-colors hover:bg-background hover:text-foreground">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] text-muted">
          {card.ticket_number}
        </span>
        <ServiceTypeBadge type={card.service_type} />
      </div>
      <div className="text-sm font-medium text-foreground line-clamp-2">
        {card.title}
      </div>
      <div className="text-xs text-foreground">{card.customer_name}</div>

      <div className="mt-1 flex items-center justify-between gap-2 border-t border-border pt-1.5 text-[11px]">
        <span className="inline-flex items-center gap-1 text-muted">
          <User size={10} weight="bold" />
          {card.assigned_to_name ?? t.repair.board.cardUnassigned}
        </span>
        {card.promised_date ? (
          <span
            className={`font-mono ${
              isOverdue
                ? 'text-danger'
                : isDueSoon
                  ? 'text-warning'
                  : 'text-muted'
            }`}
          >
            {isOverdue
              ? `+${Math.abs(days!)}d`
              : isDueSoon
                ? `${days}d`
                : card.promised_date.slice(5)}
          </span>
        ) : null}
      </div>
    </div>
  )
}

function TechChip({
  label,
  count,
  active,
  tone,
  onClick,
}: {
  label: string
  count: number | null
  active: boolean
  tone?: 'warning'
  onClick: () => void
}) {
  const base =
    'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors'
  const toneClass =
    tone === 'warning'
      ? 'border-warning/30 text-warning hover:bg-warning/5'
      : 'border-border text-foreground hover:bg-background'
  const activeRing = active ? 'ring-2 ring-ink/20 bg-background' : 'bg-card'
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${base} ${toneClass} ${activeRing}`}
    >
      {label}
      {count != null ? (
        <span className="rounded-full bg-card/60 px-1.5 py-0.5 text-[10px] font-mono text-muted">
          {count}
        </span>
      ) : null}
    </button>
  )
}
