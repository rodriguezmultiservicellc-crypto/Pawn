'use client'

import { useState } from 'react'
import { Wrench, CaretDown, CaretRight } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { formatMoney, formatDateUtc, formatDateTime } from '@/lib/portal/format'
import type {
  RepairStatus,
  ServiceType,
} from '@/types/database-aliases'

export type PortalRepairView = {
  id: string
  ticketNumber: string
  serviceType: ServiceType
  title: string | null
  itemDescription: string | null
  workNeeded: string | null
  status: RepairStatus
  promisedDate: string | null
  createdAt: string
  depositPaid: number
  totalDue: number
  balanceDue: number
  photoUrls: string[]
}

export default function PortalRepairsList({
  tickets,
}: {
  tickets: PortalRepairView[]
}) {
  const { t } = useI18n()

  if (tickets.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight text-ink">
          {t.portal.repairs.title}
        </h1>
        <div className="rounded-xl border border-hairline bg-canvas p-8 text-center">
          <Wrench
            size={32}
            weight="regular"
            className="mx-auto mb-3 text-ash"
          />
          <p className="text-sm text-ash">{t.portal.repairs.empty}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight text-ink">
        {t.portal.repairs.title}
      </h1>
      <ul className="space-y-3">
        {tickets.map((tk) => (
          <RepairCard key={tk.id} tk={tk} />
        ))}
      </ul>
    </div>
  )
}

function RepairCard({ tk }: { tk: PortalRepairView }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)

  const isReady = tk.status === 'ready'
  const isPickedUp = tk.status === 'picked_up'

  return (
    <li className="overflow-hidden rounded-xl border border-hairline bg-canvas">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-cloud"
      >
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-ink">{tk.ticketNumber}</span>
            <StatusPill status={tk.status} />
          </div>
          {tk.title ? (
            <div className="truncate text-sm text-ink">{tk.title}</div>
          ) : null}
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs text-ash">
            <span>{serviceTypeLabel(tk.serviceType, t)}</span>
            {tk.promisedDate ? (
              <span>
                {t.portal.repairs.promised}: {formatDateUtc(tk.promisedDate)}
              </span>
            ) : null}
          </div>
        </div>
        {open ? (
          <CaretDown size={16} weight="regular" className="text-ash" />
        ) : (
          <CaretRight size={16} weight="regular" className="text-ash" />
        )}
      </button>
      {open ? (
        <div className="space-y-4 border-t border-hairline px-4 py-4">
          {isReady ? (
            <div className="rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm text-success">
              {t.portal.repairs.readyHelp}
            </div>
          ) : null}
          {isPickedUp ? (
            <div className="rounded-md border border-hairline bg-cloud px-3 py-2 text-sm text-ash">
              {t.portal.repairs.pickedUpHelp}
            </div>
          ) : null}

          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            {tk.itemDescription ? (
              <div className="space-y-0.5 sm:col-span-2">
                <dt className="text-xs uppercase tracking-wide text-ash">
                  {t.portal.repairs.itemDescription}
                </dt>
                <dd className="text-ink">{tk.itemDescription}</dd>
              </div>
            ) : null}
            {tk.workNeeded ? (
              <div className="space-y-0.5 sm:col-span-2">
                <dt className="text-xs uppercase tracking-wide text-ash">
                  {t.portal.repairs.workNeeded}
                </dt>
                <dd className="text-ink">{tk.workNeeded}</dd>
              </div>
            ) : null}
            <div className="space-y-0.5">
              <dt className="text-xs uppercase tracking-wide text-ash">
                {t.portal.repairs.depositCollected}
              </dt>
              <dd className="font-mono text-ink">
                {formatMoney(tk.depositPaid)}
              </dd>
            </div>
            <div className="space-y-0.5">
              <dt className="text-xs uppercase tracking-wide text-ash">
                {t.portal.repairs.balanceDue}
              </dt>
              <dd className="font-mono text-ink">
                {formatMoney(tk.balanceDue)}
              </dd>
            </div>
            <div className="space-y-0.5">
              <dt className="text-xs uppercase tracking-wide text-ash">
                {t.portal.repairs.created}
              </dt>
              <dd className="text-ink">{formatDateTime(tk.createdAt)}</dd>
            </div>
          </dl>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ash">
              {t.portal.repairs.photosTitle}
            </h3>
            {tk.photoUrls.length === 0 ? (
              <p className="text-sm text-ash">{t.portal.repairs.noPhotos}</p>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {tk.photoUrls.map((url) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={url}
                    src={url}
                    alt=""
                    className="aspect-square w-full rounded-md border border-hairline object-cover"
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </li>
  )
}

function StatusPill({ status }: { status: RepairStatus }) {
  const { t } = useI18n()
  const label = t.portal.repairs.statusBadges[status] ?? status
  const cls =
    status === 'ready'
      ? 'bg-success/10 text-success'
      : status === 'picked_up' || status === 'voided' || status === 'abandoned'
      ? 'bg-cloud text-ash'
      : status === 'needs_parts' || status === 'awaiting_approval'
      ? 'bg-warning/10 text-warning'
      : 'bg-cloud text-ink'
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {label}
    </span>
  )
}

function serviceTypeLabel(
  type: ServiceType,
  t: ReturnType<typeof useI18n>['t'],
): string {
  // Reuse staff dictionary; portal namespace doesn't duplicate service-type
  // labels.
  switch (type) {
    case 'repair':
      return t.repair.serviceTypes.repair
    case 'stone_setting':
      return t.repair.serviceTypes.stoneSetting
    case 'sizing':
      return t.repair.serviceTypes.sizing
    case 'restring':
      return t.repair.serviceTypes.restring
    case 'plating':
      return t.repair.serviceTypes.plating
    case 'engraving':
      return t.repair.serviceTypes.engraving
    case 'custom':
      return t.repair.serviceTypes.custom
    default:
      return type
  }
}
