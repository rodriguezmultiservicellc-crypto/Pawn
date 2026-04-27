'use client'

import { useState, useTransition } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import {
  ArrowRight,
  Check,
  Clock,
  Image as ImageIcon,
  Prohibit,
  X,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import {
  acceptTransferAction,
  cancelTransferAction,
  rejectTransferAction,
} from './actions'
import type { TransferStatus } from '@/types/database-aliases'

export type TransferDetailItem = {
  id: string
  inventory_item_id: string
  sku: string | null
  description: string | null
  category: string | null
  est_value: number | null
  thumb_url: string | null
  currently_owned_by_active: boolean
}

export type TransferDetailData = {
  id: string
  status: TransferStatus
  from_tenant_id: string
  to_tenant_id: string
  from_shop_label: string
  to_shop_label: string
  notes: string | null
  rejection_reason: string | null
  requested_at: string | null
  requested_by_label: string | null
  accepted_at: string | null
  accepted_by_label: string | null
  rejected_at: string | null
  rejected_by_label: string | null
  cancelled_at: string | null
  cancelled_by_label: string | null
  items: TransferDetailItem[]
  viewerSide: 'from' | 'to'
}

const STATUS_BADGE: Record<
  TransferStatus,
  { bg: string; text: string }
> = {
  pending: { bg: 'bg-warning/10 border-warning/30', text: 'text-warning' },
  accepted: { bg: 'bg-success/10 border-success/30', text: 'text-success' },
  rejected: { bg: 'bg-error/10 border-error/30', text: 'text-error' },
  cancelled: { bg: 'bg-cloud border-hairline', text: 'text-ash' },
  in_transit: { bg: 'bg-cloud border-hairline', text: 'text-ash' },
  received: { bg: 'bg-cloud border-hairline', text: 'text-ash' },
}

export default function TransferDetail({
  data,
}: {
  data: TransferDetailData
  /** Reserved for future cross-shop UI variants. */
  activeTenantId: string
}) {
  const { t } = useI18n()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [showRejectDialog, setShowRejectDialog] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  const isPending = data.status === 'pending'
  const showCancelButton = isPending && data.viewerSide === 'from'
  const showAcceptRejectButtons = isPending && data.viewerSide === 'to'

  function onCancel() {
    if (!confirm(t.inventory.transfers.actions.confirmCancel)) return
    const fd = new FormData()
    fd.set('transfer_id', data.id)
    setError(null)
    startTransition(async () => {
      const res = await cancelTransferAction(fd)
      if (res?.error) setError(translateError(res.error, t))
    })
  }

  function onAccept() {
    if (!confirm(t.inventory.transfers.actions.confirmAccept)) return
    const fd = new FormData()
    fd.set('transfer_id', data.id)
    setError(null)
    startTransition(async () => {
      const res = await acceptTransferAction(fd)
      if (res?.error) setError(translateError(res.error, t))
    })
  }

  function onSubmitReject() {
    const fd = new FormData()
    fd.set('transfer_id', data.id)
    fd.set('reason', rejectReason)
    setError(null)
    startTransition(async () => {
      const res = await rejectTransferAction(fd)
      if (res?.error) {
        setError(translateError(res.error, t))
      } else {
        setShowRejectDialog(false)
        setRejectReason('')
      }
    })
  }

  const badge = STATUS_BADGE[data.status]

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/inventory/transfers"
            className="text-sm text-ash hover:text-ink"
          >
            ← {t.inventory.transfers.detail.backToList}
          </Link>
          <div className="mt-1 flex items-center gap-3">
            <h1 className="text-2xl font-bold">
              {t.inventory.transfers.detail.title}
            </h1>
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${badge.bg} ${badge.text}`}
            >
              {labelForStatus(data.status, t)}
            </span>
          </div>
          <p className="mt-1 font-mono text-xs text-ash">
            {data.id.slice(0, 8)}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {showCancelButton ? (
            <button
              type="button"
              onClick={onCancel}
              disabled={pending}
              className="inline-flex items-center gap-1 rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink hover:border-error hover:text-error disabled:opacity-50"
            >
              <X size={14} weight="bold" />
              {pending
                ? t.inventory.transfers.actions.cancelling
                : t.inventory.transfers.actions.cancel}
            </button>
          ) : null}
          {showAcceptRejectButtons ? (
            <>
              <button
                type="button"
                onClick={() => setShowRejectDialog(true)}
                disabled={pending}
                className="inline-flex items-center gap-1 rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink hover:border-error hover:text-error disabled:opacity-50"
              >
                <Prohibit size={14} weight="bold" />
                {t.inventory.transfers.actions.reject}
              </button>
              <button
                type="button"
                onClick={onAccept}
                disabled={pending}
                className="inline-flex items-center gap-1 rounded-md bg-success px-3 py-2 text-sm font-medium text-canvas hover:opacity-90 disabled:opacity-50"
              >
                <Check size={14} weight="bold" />
                {pending
                  ? t.inventory.transfers.actions.accepting
                  : t.inventory.transfers.actions.accept}
              </button>
            </>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">
          {error}
        </div>
      ) : null}

      <div className="rounded-lg border border-hairline bg-canvas p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-7 sm:items-center">
          <div className="sm:col-span-3">
            <p className="text-xs uppercase tracking-wide text-ash">
              {t.inventory.transfers.detail.fromShop}
            </p>
            <p className="mt-1 text-base font-semibold text-ink">
              {data.from_shop_label}
            </p>
          </div>
          <div className="hidden text-center sm:col-span-1 sm:block">
            <ArrowRight size={22} weight="bold" className="mx-auto text-ash" />
          </div>
          <div className="sm:col-span-3">
            <p className="text-xs uppercase tracking-wide text-ash">
              {t.inventory.transfers.detail.toShop}
            </p>
            <p className="mt-1 text-base font-semibold text-ink">
              {data.to_shop_label}
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-hairline bg-canvas">
        <div className="border-b border-hairline px-5 py-3">
          <h2 className="text-sm font-semibold text-ink">
            {t.inventory.transfers.detail.items}
            <span className="ml-2 font-normal text-ash">
              ({data.items.length})
            </span>
          </h2>
        </div>

        {data.items.length === 0 ? (
          <p className="px-5 py-6 text-sm text-ash">
            {t.inventory.transfers.detail.noItems}
          </p>
        ) : (
          <div className="divide-y divide-hairline">
            {data.items.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-4 px-5 py-3"
              >
                <div className="relative h-12 w-12 overflow-hidden rounded-md border border-hairline bg-cloud">
                  {item.thumb_url ? (
                    <Image
                      src={item.thumb_url}
                      alt=""
                      fill
                      sizes="48px"
                      unoptimized
                      className="object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-ash">
                      <ImageIcon size={18} />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">
                    {item.description ?? '—'}
                  </p>
                  <p className="text-xs text-ash">
                    <span className="font-mono">{item.sku ?? '—'}</span>
                    {item.category ? <span> · {item.category}</span> : null}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm text-ink">
                    {item.est_value != null
                      ? formatMoney(item.est_value)
                      : '—'}
                  </p>
                  {item.currently_owned_by_active ? (
                    <Link
                      href={`/inventory/${item.inventory_item_id}`}
                      className="text-xs text-rausch hover:underline"
                    >
                      {t.inventory.transfers.detail.viewItem}
                    </Link>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {data.notes ? (
        <div className="rounded-lg border border-hairline bg-canvas p-5">
          <p className="text-xs uppercase tracking-wide text-ash">
            {t.inventory.transfers.detail.notes}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-ink">
            {data.notes}
          </p>
        </div>
      ) : null}

      {data.status === 'rejected' && data.rejection_reason ? (
        <div className="rounded-lg border border-error/30 bg-error/5 p-5">
          <p className="text-xs uppercase tracking-wide text-error">
            {t.inventory.transfers.detail.rejectionReason}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-ink">
            {data.rejection_reason}
          </p>
        </div>
      ) : null}

      <div className="rounded-lg border border-hairline bg-canvas p-5">
        <h3 className="mb-3 text-xs uppercase tracking-wide text-ash">
          {t.inventory.transfers.detail.timeline}
        </h3>
        <ul className="space-y-2 text-sm">
          <TimelineRow
            icon={<Clock size={14} className="text-ash" />}
            label={t.inventory.transfers.detail.requestedAt}
            who={data.requested_by_label}
            when={data.requested_at}
          />
          {data.accepted_at ? (
            <TimelineRow
              icon={<Check size={14} className="text-success" />}
              label={t.inventory.transfers.detail.acceptedAt}
              who={data.accepted_by_label}
              when={data.accepted_at}
            />
          ) : null}
          {data.rejected_at ? (
            <TimelineRow
              icon={<Prohibit size={14} className="text-error" />}
              label={t.inventory.transfers.detail.rejectedAt}
              who={data.rejected_by_label}
              when={data.rejected_at}
            />
          ) : null}
          {data.cancelled_at ? (
            <TimelineRow
              icon={<X size={14} className="text-ash" />}
              label={t.inventory.transfers.detail.cancelledAt}
              who={data.cancelled_by_label}
              when={data.cancelled_at}
            />
          ) : null}
        </ul>
      </div>

      {showRejectDialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4">
          <div className="w-full max-w-md rounded-lg border border-hairline bg-canvas p-6 shadow-lg">
            <h3 className="text-lg font-semibold text-ink">
              {t.inventory.transfers.actions.confirmReject}
            </h3>
            <label
              htmlFor="reject_reason"
              className="mt-4 block text-sm font-medium text-ink"
            >
              {t.inventory.transfers.actions.rejectReasonLabel}
            </label>
            <textarea
              id="reject_reason"
              rows={4}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder={t.inventory.transfers.actions.rejectReasonPlaceholder}
              className="mt-1 block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
            />
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowRejectDialog(false)
                  setRejectReason('')
                  setError(null)
                }}
                disabled={pending}
                className="rounded-md border border-hairline px-3 py-2 text-sm text-ink"
              >
                {t.common.cancel}
              </button>
              <button
                type="button"
                onClick={onSubmitReject}
                disabled={pending || rejectReason.trim().length < 10}
                className="rounded-md bg-error px-3 py-2 text-sm font-medium text-canvas hover:opacity-90 disabled:opacity-50"
              >
                {pending
                  ? t.inventory.transfers.actions.rejecting
                  : t.inventory.transfers.actions.submitReject}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function TimelineRow({
  icon,
  label,
  who,
  when,
}: {
  icon: React.ReactNode
  label: string
  who: string | null
  when: string | null
}) {
  return (
    <li className="flex items-center gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-hairline bg-canvas">
        {icon}
      </span>
      <span className="text-sm text-ink">{label}</span>
      <span className="text-xs text-ash">
        {when ? new Date(when).toLocaleString() : '—'}
        {who ? ` · ${who}` : ''}
      </span>
    </li>
  )
}

function formatMoney(v: number): string {
  if (!isFinite(v)) return '—'
  return v.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  })
}

function labelForStatus(
  s: TransferStatus,
  t: ReturnType<typeof useI18n>['t'],
): string {
  switch (s) {
    case 'pending':
      return t.inventory.transfers.statusBadges.pending
    case 'accepted':
      return t.inventory.transfers.statusBadges.accepted
    case 'rejected':
      return t.inventory.transfers.statusBadges.rejected
    case 'cancelled':
      return t.inventory.transfers.statusBadges.cancelled
    default:
      return s
  }
}

function translateError(
  err: string,
  t: ReturnType<typeof useI18n>['t'],
): string {
  switch (err) {
    case 'wrong_status':
      return t.inventory.transfers.errors.wrongStatus
    case 'not_authorized':
      return t.inventory.transfers.errors.notAuthorized
    case 'cross_chain_blocked':
      return t.inventory.transfers.errors.crossChainBlocked
    case 'reason_too_short':
      return t.inventory.transfers.actions.rejectReasonPlaceholder
    case 'validation_failed':
      return t.inventory.transfers.errors.validationFailed
    default:
      return err
  }
}
