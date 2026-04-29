'use client'

import { useTransition } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, User } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { daysBetween } from '@/lib/pawn/math'
import { ServiceTypeBadge } from '@/components/repair/ServiceTypeBadge'
import { StatusBadge } from '@/components/repair/StatusBadge'
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
  cardsByStatus: Record<RepairStatus, BoardCard[]>
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
    (sum, status) => sum + cardsByStatus[status].length,
    0,
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/repair"
            className="mb-1 inline-flex items-center gap-1 text-xs text-ash hover:text-ink"
          >
            <ArrowLeft size={12} weight="bold" />
            {t.repair.board.backToList}
          </Link>
          <h1 className="text-2xl font-bold">{t.repair.board.title}</h1>
          <p className="text-sm text-ash">{t.repair.board.subtitle}</p>
        </div>
        <div className="text-right">
          <div className="font-mono text-2xl font-semibold text-ink">
            {totalCards}
          </div>
          <div className="text-[11px] text-ash">{t.repair.board.totalActive}</div>
        </div>
      </div>

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
        <label className="text-xs text-ash">
          {t.repair.list.serviceType}:
        </label>
        <select
          value={serviceTypeFilter}
          onChange={(e) => pushParams({ serviceType: e.target.value })}
          className="rounded-md border border-hairline bg-canvas px-3 py-1.5 text-sm text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
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
        {pending ? (
          <span className="text-[11px] text-ash">{t.common.loading}</span>
        ) : null}
      </div>

      {/* Columns */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {columns.map((status) => (
          <Column
            key={status}
            status={status}
            cards={cardsByStatus[status]}
            today={today}
            onCardClick={(id) => router.push(`/repair/${id}`)}
          />
        ))}
      </div>
    </div>
  )
}

function Column({
  status,
  cards,
  today,
  onCardClick,
}: {
  status: RepairStatus
  cards: BoardCard[]
  today: string
  onCardClick: (id: string) => void
}) {
  const { t } = useI18n()
  return (
    <div className="flex flex-col rounded-lg border border-hairline bg-cloud/40">
      <div className="flex items-center justify-between border-b border-hairline px-3 py-2">
        <StatusBadge status={status} />
        <span className="font-mono text-xs text-ash">{cards.length}</span>
      </div>
      <div className="flex flex-col gap-2 p-2">
        {cards.length === 0 ? (
          <div className="px-2 py-6 text-center text-[11px] text-ash">
            {t.repair.board.columnEmpty}
          </div>
        ) : (
          cards.map((card) => (
            <Card
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

function Card({
  card,
  today,
  onClick,
}: {
  card: BoardCard
  today: string
  onClick: () => void
}) {
  const { t } = useI18n()
  const days =
    card.promised_date != null ? daysBetween(today, card.promised_date) : null
  const isOverdue = days != null && days < 0
  const isDueSoon = days != null && days >= 0 && days <= 7

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col gap-1.5 rounded-md border border-hairline bg-canvas p-2.5 text-left transition-colors hover:border-ink"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] text-ash">
          {card.ticket_number}
        </span>
        <ServiceTypeBadge type={card.service_type} />
      </div>
      <div className="text-sm font-medium text-ink line-clamp-2">
        {card.title}
      </div>
      <div className="text-xs text-ink">{card.customer_name}</div>

      <div className="mt-1 flex items-center justify-between gap-2 border-t border-hairline pt-1.5 text-[11px]">
        <span className="inline-flex items-center gap-1 text-ash">
          <User size={10} weight="bold" />
          {card.assigned_to_name ?? t.repair.board.cardUnassigned}
        </span>
        {card.promised_date ? (
          <span
            className={`font-mono ${
              isOverdue
                ? 'text-error'
                : isDueSoon
                  ? 'text-warning'
                  : 'text-ash'
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
    </button>
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
      : 'border-hairline text-ink hover:bg-cloud'
  const activeRing = active ? 'ring-2 ring-ink/20 bg-cloud' : 'bg-canvas'
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${base} ${toneClass} ${activeRing}`}
    >
      {label}
      {count != null ? (
        <span className="rounded-full bg-canvas/60 px-1.5 py-0.5 text-[10px] font-mono text-ash">
          {count}
        </span>
      ) : null}
    </button>
  )
}

