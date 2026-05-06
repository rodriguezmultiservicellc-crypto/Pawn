'use client'

import { useState, useTransition } from 'react'
import { CheckCircle, PaperPlaneTilt, X } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import type { MessageChannel, MessageKind } from '@/types/database-aliases'

export type SendReminderDialogProps = {
  customerId: string
  /** Optional: customer name for the dialog header. */
  customerName?: string
  /** Limit which kinds appear in the picker. Defaults to all. */
  allowedKinds?: ReadonlyArray<MessageKind>
  /** Default kind to pre-select. */
  defaultKind: MessageKind
  /** Optional: pin the channel. NULL ⇒ use customer's preferred channel. */
  defaultChannel?: MessageChannel | null
  /** Related-row IDs forwarded to the server action. */
  related?: {
    loanId?: string | null
    repairTicketId?: string | null
    layawayId?: string | null
  }
  onClose: () => void
  /** The form action — typically `manualSendAction` from /settings/communications. */
  action: (
    prev: { ok: true } | { error: string; fieldErrors?: Record<string, string> } | null,
    formData: FormData,
  ) => Promise<{ ok: true } | { error: string; fieldErrors?: Record<string, string> }>
}

const ALL_KINDS: MessageKind[] = [
  'loan_maturity_t7',
  'loan_maturity_t1',
  'loan_due_today',
  'loan_overdue_t1',
  'loan_overdue_t7',
  'repair_ready',
  'repair_pickup_reminder',
  'layaway_payment_due',
  'layaway_overdue',
  'layaway_completed',
  'custom',
]

export function SendReminderDialog({
  customerId,
  customerName,
  allowedKinds,
  defaultKind,
  defaultChannel,
  related,
  onClose,
  action,
}: SendReminderDialogProps) {
  const { t } = useI18n()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [kind, setKind] = useState<MessageKind>(defaultKind)
  const [channel, setChannel] = useState<MessageChannel | ''>(
    defaultChannel ?? '',
  )

  const kinds = allowedKinds ?? ALL_KINDS

  function submit() {
    setError(null)
    setSuccess(false)
    const fd = new FormData()
    fd.set('customer_id', customerId)
    fd.set('kind', kind)
    if (channel) fd.set('channel', channel)
    if (related?.loanId) fd.set('related_loan_id', related.loanId)
    if (related?.repairTicketId)
      fd.set('related_repair_ticket_id', related.repairTicketId)
    if (related?.layawayId) fd.set('related_layaway_id', related.layawayId)
    startTransition(async () => {
      const res = await action(null, fd)
      if ('error' in res) setError(res.error)
      else setSuccess(true)
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-lg">
        <header className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-foreground">
              {t.comms.sendDialogTitle}
            </h3>
            {customerName ? (
              <p className="text-xs text-muted">{customerName}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted hover:bg-background hover:text-foreground"
            aria-label="close"
          >
            <X size={16} weight="bold" />
          </button>
        </header>

        {error ? (
          <div className="mb-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
            {error}
          </div>
        ) : null}

        {success ? (
          <div className="mb-3 inline-flex items-center gap-1 rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm text-success-deep">
            <CheckCircle size={14} weight="bold" />
            {t.comms.sendDialogSuccess}
          </div>
        ) : null}

        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-sm font-medium text-foreground">
              {t.comms.sendDialogKind}
            </span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as MessageKind)}
              className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
            >
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {t.comms.kindLabels[k]}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-sm font-medium text-foreground">
              {t.comms.sendDialogChannel}
            </span>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value as MessageChannel | '')}
              className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
            >
              <option value="">{t.comms.sendDialogChannelDefault}</option>
              <option value="sms">{t.comms.channelSms}</option>
              <option value="whatsapp">{t.comms.channelWhatsapp}</option>
              <option value="email">{t.comms.channelEmail}</option>
            </select>
          </label>

          <p className="text-xs text-muted">{t.comms.sendDialogHelp}</p>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border bg-card px-4 py-2 text-sm text-foreground hover:border-foreground"
          >
            {t.common.close}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={submit}
            className="inline-flex items-center gap-1 rounded-md bg-gold px-4 py-2 text-sm font-medium text-navy hover:bg-gold-2 disabled:opacity-50"
          >
            <PaperPlaneTilt size={14} weight="bold" />
            {pending ? t.common.saving : t.comms.sendDialogSubmit}
          </button>
        </div>
      </div>
    </div>
  )
}
