'use client'

import { useI18n } from '@/lib/i18n/context'
import type {
  CardPresentStatus,
  LayawayStatus,
  RegisterSessionStatus,
  SaleStatus,
} from '@/types/database-aliases'

const SALE_TONE: Record<SaleStatus, string> = {
  open: 'border-warning/30 bg-warning/5 text-warning',
  completed: 'border-success/30 bg-success/5 text-success',
  voided: 'border-danger/30 bg-danger/5 text-danger',
  partial_returned: 'border-warning/30 bg-warning/5 text-warning',
  fully_returned: 'border-cloud border-border bg-background text-muted',
}

export function SaleStatusBadge({ status }: { status: SaleStatus }) {
  const { t } = useI18n()
  const label = t.pos.statusBadges.sale[status]
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${SALE_TONE[status]}`}
    >
      {label}
    </span>
  )
}

const LAYAWAY_TONE: Record<LayawayStatus, string> = {
  active: 'border-success/30 bg-success/5 text-success',
  completed: 'border-cloud border-border bg-background text-muted',
  cancelled: 'border-danger/30 bg-danger/5 text-danger',
  defaulted: 'border-warning/30 bg-warning/5 text-warning',
}

export function LayawayStatusBadge({ status }: { status: LayawayStatus }) {
  const { t } = useI18n()
  const label = t.pos.statusBadges.layaway[status]
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${LAYAWAY_TONE[status]}`}
    >
      {label}
    </span>
  )
}

const REGISTER_TONE: Record<RegisterSessionStatus, string> = {
  open: 'border-success/30 bg-success/5 text-success',
  closed: 'border-cloud border-border bg-background text-muted',
  reconciled: 'border-cloud border-border bg-background text-foreground',
}

export function RegisterStatusBadge({
  status,
}: {
  status: RegisterSessionStatus
}) {
  const { t } = useI18n()
  const label = t.pos.statusBadges.register[status]
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${REGISTER_TONE[status]}`}
    >
      {label}
    </span>
  )
}

const CARD_TONE: Record<CardPresentStatus, string> = {
  not_used: 'border-cloud border-border bg-background text-muted',
  pending: 'border-warning/30 bg-warning/5 text-warning',
  succeeded: 'border-success/30 bg-success/5 text-success',
  failed: 'border-danger/30 bg-danger/5 text-danger',
  refunded: 'border-cloud border-border bg-background text-muted',
}

export function CardPresentBadge({
  status,
}: {
  status: CardPresentStatus
}) {
  const { t } = useI18n()
  const label = t.pos.statusBadges.cardPresent[status]
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${CARD_TONE[status]}`}
    >
      {label}
    </span>
  )
}
