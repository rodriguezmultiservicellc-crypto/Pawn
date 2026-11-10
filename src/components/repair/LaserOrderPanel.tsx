'use client'

import { useEffect, useState, useSyncExternalStore, useTransition } from 'react'
import Link from 'next/link'
import {
  ArrowsClockwise,
  Lightning,
  PaperPlaneTilt,
  Prohibit,
  WarningCircle,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { shortDateTime } from '@/lib/format/money'
import { isOpenLaserStatus, type LaserOrderStatus } from '@/lib/orocut/status'
import type { CutDetails, HistoryEntry } from '@/lib/orocut/merge'
import {
  cancelLaserOrderAction,
  refreshLaserOrderAction,
  sendToLaserAction,
  type LaserActionResult,
} from '@/app/(staff)/repair/laser-actions'

/**
 * Ticket-detail panel: "Send to laser" for nameplate orders (patches/0070).
 * One open order at a time; earlier ones fold away underneath. While an
 * order is open the panel re-checks orocut.com once a minute (the webhook
 * is the fast path; this covers a missed delivery and local development).
 */

export type LaserOrderView = {
  id: string
  external_id: string
  orocut_order_id: string
  status: LaserOrderStatus
  text: string
  text2: string | null
  style: string | null
  quantity: number
  metal: string | null
  thickness_mm: number | null
  chain_length_in: number | null
  height_mm: number | null
  customer_name: string | null
  due_at: string | null
  notes: string | null
  picture_url: string | null
  reject_reason: string | null
  cut_details: CutDetails | null
  cut_count: number
  status_history: HistoryEntry[]
  sent_at: string
  last_synced_at: string | null
  last_sync_error: string | null
  finished_at: string | null
}

export type LaserPanelData = {
  /** vault has the orocut.com order token */
  configured: boolean
  /** owner / chain_admin → show the "connect it" hint when not configured */
  canConfigure: boolean
  styleNames: string[]
  orders: LaserOrderView[]
}

const POLL_MS = 60_000

export function LaserOrderPanel({
  ticketId,
  customerName,
  promisedDate,
  isTerminal,
  data,
}: {
  ticketId: string
  customerName: string
  promisedDate: string | null
  isTerminal: boolean
  data: LaserPanelData
}) {
  const { t } = useI18n()
  const tl = t.repair.laser
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<LaserActionResult | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const open = data.orders.find((o) => isOpenLaserStatus(o.status)) ?? null
  const past = data.orders.filter((o) => !isOpenLaserStatus(o.status))

  function run(action: (fd: FormData) => Promise<LaserActionResult>, fd: FormData, onOk?: () => void) {
    setError(null)
    startTransition(async () => {
      const res = await action(fd)
      if (res.error) {
        setError(res)
        setFieldErrors(res.fieldErrors ?? {})
      } else {
        setFieldErrors({})
        onOk?.()
      }
    })
  }

  // Poll while an order is open and the tab is visible.
  const openId = open?.id ?? null
  useEffect(() => {
    if (!openId) return
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      const fd = new FormData()
      fd.set('order_id', openId)
      startTransition(async () => {
        await refreshLaserOrderAction(fd)
      })
    }, POLL_MS)
    return () => window.clearInterval(id)
  }, [openId])

  if (!data.configured) {
    if (!data.canConfigure) return null
    return (
      <section className="rounded-xl border border-dashed border-border bg-card px-4 py-3">
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <Lightning size={16} weight="bold" />
          {tl.notConfigured}
          <Link href="/settings/integrations/orocut" className="text-blue hover:underline">
            {tl.configureLink}
          </Link>
        </p>
      </section>
    )
  }

  const errorText = error ? readable(error, tl) : null

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Lightning size={16} weight="bold" />
          {tl.title}
        </h2>
        <p className="text-xs text-muted">{tl.help}</p>
      </header>

      <div className="space-y-4 p-4">
        {open ? (
          <OpenOrder
            order={open}
            pending={pending}
            onRefresh={() => {
              const fd = new FormData()
              fd.set('order_id', open.id)
              run(refreshLaserOrderAction, fd)
            }}
            onCancel={() => {
              if (!window.confirm(tl.cancelConfirm)) return
              const fd = new FormData()
              fd.set('order_id', open.id)
              run(cancelLaserOrderAction, fd)
            }}
          />
        ) : showForm ? (
          <SendForm
            ticketId={ticketId}
            customerName={customerName}
            promisedDate={promisedDate}
            styleNames={data.styleNames}
            pending={pending}
            fieldErrors={fieldErrors}
            onCancel={() => {
              setShowForm(false)
              setFieldErrors({})
              setError(null)
            }}
            onSubmit={(fd) => run(sendToLaserAction, fd, () => setShowForm(false))}
          />
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setShowForm(true)}
              disabled={isTerminal || pending}
              className="inline-flex items-center gap-1 rounded-md border border-gold bg-gold px-3 py-1.5 text-xs font-bold text-navy hover:bg-gold-2 disabled:opacity-50"
            >
              <PaperPlaneTilt size={14} weight="bold" />
              {tl.send}
            </button>
            {isTerminal ? <span className="text-xs text-muted">{tl.errors.ticket_closed}</span> : null}
          </div>
        )}

        {errorText ? (
          <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger" role="alert">
            {errorText}
          </div>
        ) : null}

        {past.length > 0 ? (
          <details className="rounded-md border border-border bg-background/60">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted">
              {tl.pastOrders} ({past.length})
            </summary>
            <ul className="divide-y divide-border">
              {past.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
                  <span className="flex items-center gap-2">
                    <StatusBadge status={o.status} />
                    <span className="font-semibold text-foreground">{o.text}</span>
                    {o.style ? <span className="text-muted">· {o.style}</span> : null}
                    {o.quantity > 1 ? <span className="font-mono text-muted">×{o.quantity}</span> : null}
                  </span>
                  <span className="font-mono text-muted">
                    <ClientTime iso={o.finished_at ?? o.sent_at} />
                    {o.status === 'rejected' && o.reject_reason ? ` — ${o.reject_reason}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </section>
  )
}

// ── Open order ────────────────────────────────────────────────────────────

function OpenOrder({
  order,
  pending,
  onRefresh,
  onCancel,
}: {
  order: LaserOrderView
  pending: boolean
  onRefresh: () => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  const tl = t.repair.laser
  const d = order.cut_details
  const specs = [
    order.metal,
    order.thickness_mm != null ? `${order.thickness_mm} mm` : null,
    order.height_mm != null ? `${tl.form.height}: ${order.height_mm}` : null,
    order.chain_length_in != null ? `${tl.form.chain}: ${order.chain_length_in}` : null,
  ].filter(Boolean)

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={order.status} />
          <span className="font-mono text-xs text-muted">
            {tl.orderLabel} {order.external_id}
          </span>
          {order.cut_count > 0 ? (
            <span className="font-mono text-xs text-muted">
              · {tl.cutCount.replace('{n}', String(order.cut_count))}
            </span>
          ) : null}
        </div>
        <div className="text-lg font-semibold text-foreground">
          {order.text}
          {order.quantity > 1 ? <span className="ml-2 font-mono text-sm text-muted">×{order.quantity}</span> : null}
        </div>
        {order.text2 ? <div className="text-sm text-foreground">{order.text2}</div> : null}
        <div className="text-xs text-muted">
          {order.style ?? tl.form.styleNone}
          {specs.length > 0 ? ` · ${specs.join(' · ')}` : ''}
        </div>
        {order.notes ? <p className="text-xs text-muted">{order.notes}</p> : null}
        {d ? (
          <p className="text-xs text-foreground">
            {tl.cutDetails}:{' '}
            {[
              d.width_mm != null && d.height_mm != null ? `${d.width_mm}×${d.height_mm} mm` : null,
              d.minutes != null ? `${d.minutes} min` : null,
              d.passes != null ? `${d.passes}p` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            onClick={onRefresh}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-background disabled:opacity-50"
          >
            <ArrowsClockwise size={14} weight="bold" />
            {pending ? tl.refreshing : tl.refresh}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md border border-danger/30 bg-danger/5 px-2.5 py-1.5 text-xs font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
          >
            <Prohibit size={14} weight="bold" />
            {tl.cancel}
          </button>
        </div>
        <p className="text-[11px] text-muted">
          {tl.sentLabel} <ClientTime iso={order.sent_at} /> · {tl.lastChecked}{' '}
          {order.last_synced_at ? <ClientTime iso={order.last_synced_at} /> : tl.never}
          {order.last_sync_error ? (
            <span className="ml-1 inline-flex items-center gap-1 text-warning">
              <WarningCircle size={11} weight="bold" />
              {tl.syncError}
            </span>
          ) : null}
        </p>
      </div>

      <div>
        <div className="text-xs uppercase tracking-wide text-muted">{tl.history}</div>
        <ol className="mt-1 space-y-1">
          {[...order.status_history].reverse().map((h, i) => (
            <li key={`${h.at}-${i}`} className="flex items-start justify-between gap-2 text-xs">
              <span className="text-foreground">
                {tl.status[h.status]}
                {h.by && h.via !== 'app' ? <span className="text-muted"> · {h.by}</span> : null}
                {h.reason ? <span className="text-muted"> — {h.reason}</span> : null}
              </span>
              <span className="shrink-0 font-mono text-muted">
                <ClientTime iso={h.at} />
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

// ── Times ─────────────────────────────────────────────────────────────────

const noopSubscribe = () => () => {}

/**
 * Local-time stamp rendered only after mount. The server renders in UTC and
 * the browser in the shop's zone, so formatting during SSR produces a text
 * mismatch (React #418) on every load; an empty server placeholder does not.
 */
function ClientTime({ iso }: { iso: string }) {
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  )
  return <>{mounted ? shortDateTime(iso) : '…'}</>
}

// ── Send form ─────────────────────────────────────────────────────────────

function SendForm({
  ticketId,
  customerName,
  promisedDate,
  styleNames,
  pending,
  fieldErrors,
  onCancel,
  onSubmit,
}: {
  ticketId: string
  customerName: string
  promisedDate: string | null
  styleNames: string[]
  pending: boolean
  fieldErrors: Record<string, string>
  onCancel: () => void
  onSubmit: (fd: FormData) => void
}) {
  const { t } = useI18n()
  const tl = t.repair.laser
  const fe = (k: string) => {
    const code = fieldErrors[k]
    if (!code) return null
    return (tl.fieldErrors as Record<string, string>)[code] ?? code
  }
  const input =
    'w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground'

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        const fd = new FormData(e.currentTarget)
        fd.set('ticket_id', ticketId)
        onSubmit(fd)
      }}
      className="space-y-3"
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label={tl.form.text} help={tl.form.textHelp} error={fe('text')}>
          <input name="text" required maxLength={60} className={`${input} font-semibold`} autoFocus />
        </Field>
        <Field label={tl.form.text2} help={tl.form.text2Help} error={fe('text2')}>
          <input name="text2" maxLength={60} className={input} />
        </Field>
        <Field label={tl.form.style} help={tl.form.styleHelp} error={fe('style')}>
          {styleNames.length > 0 ? (
            <select name="style" className={input} defaultValue="">
              <option value="">{tl.form.styleNone}</option>
              {styleNames.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          ) : (
            <input name="style" maxLength={80} className={input} placeholder={tl.form.styleNone} />
          )}
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label={tl.form.quantity} error={fe('quantity')}>
            <input name="quantity" type="number" min={1} max={50} step={1} defaultValue={1} className={`${input} font-mono`} />
          </Field>
          <Field label={tl.form.thickness} error={fe('thickness_mm')}>
            <input name="thickness_mm" type="number" min={0.1} max={5} step={0.01} className={`${input} font-mono`} />
          </Field>
          <Field label={tl.form.height} error={fe('height_mm')}>
            <input name="height_mm" type="number" min={2} max={60} step={0.1} className={`${input} font-mono`} />
          </Field>
        </div>
        <Field label={tl.form.metal} error={fe('metal')}>
          <input name="metal" maxLength={40} className={input} placeholder={tl.form.metalPlaceholder} />
        </Field>
        <Field label={tl.form.chain} error={fe('chain_length_in')}>
          <input name="chain_length_in" type="number" min={6} max={36} step={0.5} className={`${input} font-mono`} />
        </Field>
        <Field label={tl.form.customer} error={fe('customer_name')}>
          <input name="customer_name" maxLength={80} defaultValue={customerName} className={input} />
        </Field>
        <Field label={tl.form.dueAt} error={fe('due_at')}>
          <input name="due_at" type="date" defaultValue={promisedDate ?? ''} className={`${input} font-mono`} />
        </Field>
        <Field label={tl.form.pictureUrl} error={fe('picture_url')}>
          <input name="picture_url" type="url" maxLength={2048} className={`${input} font-mono text-xs`} placeholder="https://" />
        </Field>
        <Field label={tl.form.notes} error={fe('notes')}>
          <textarea name="notes" maxLength={1000} rows={2} className={input} />
        </Field>
      </div>
      <p className="text-[11px] text-muted">{tl.form.heightHelp}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-md border border-gold bg-gold px-3 py-1.5 text-xs font-bold text-navy hover:bg-gold-2 disabled:opacity-50"
        >
          <PaperPlaneTilt size={14} weight="bold" />
          {pending ? tl.sending : tl.form.submit}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-background disabled:opacity-50"
        >
          {tl.form.back}
        </button>
      </div>
    </form>
  )
}

function Field({
  label,
  help,
  error,
  children,
}: {
  label: string
  help?: string
  error?: string | null
  children: React.ReactNode
}) {
  return (
    <label className="block space-y-1">
      <span className="block text-xs font-semibold text-foreground">{label}</span>
      {children}
      {error ? (
        <span className="block text-xs text-danger">{error}</span>
      ) : help ? (
        <span className="block text-[11px] text-muted">{help}</span>
      ) : null}
    </label>
  )
}

// ── Status badge ──────────────────────────────────────────────────────────

export function StatusBadge({ status }: { status: LaserOrderStatus }) {
  const { t } = useI18n()
  const cls: Record<LaserOrderStatus, string> = {
    new: 'bg-info/10 text-info border-info/30',
    received: 'bg-info/10 text-info border-info/30',
    cut: 'bg-warning/10 text-warning border-warning/30',
    done: 'bg-success/10 text-success border-success/30',
    rejected: 'bg-danger/10 text-danger border-danger/30',
    cancelled: 'bg-background text-muted border-border',
  }
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${cls[status]}`}
    >
      {t.repair.laser.status[status]}
    </span>
  )
}

function readable(res: LaserActionResult, tl: { errors: Record<string, string>; status: Record<string, string> }): string {
  const code = res.error ?? ''
  const base = tl.errors[code] ?? code
  if (code === 'remote' && res.detail) return base.replace('{detail}', res.detail)
  if (code === 'cancel_refused') return base.replace('{status}', res.status ? tl.status[res.status] ?? res.status : '—')
  return base
}
