'use client'

import { useMemo, useState, useTransition } from 'react'
import {
  ChatCircleText,
  EnvelopeSimple,
  Gear,
  PaperPlaneTilt,
  WhatsappLogo,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { CredsForm } from '@/components/comms/CredsForm'
import { TemplateEditor } from '@/components/comms/TemplateEditor'
import { TestSendDialog } from '@/components/comms/TestSendDialog'
import {
  testSendTemplateAction,
  toggleMessageTemplateAction,
  updateCommsSettingsAction,
  updateMessageTemplateAction,
  type ActionResult,
} from './actions'
import type { MessageChannel, MessageKind } from '@/types/database-aliases'

export type CommsSettingsView = {
  twilio_account_sid: string | null
  twilio_auth_token_set: boolean
  twilio_sms_from: string | null
  twilio_whatsapp_from: string | null
  twilio_messaging_service_sid: string | null
  resend_api_key_set: boolean
  resend_from_email: string | null
  resend_from_name: string | null
}

export type TemplateRowView = {
  id: string
  kind: MessageKind
  language: 'en' | 'es'
  channel: MessageChannel
  subject: string | null
  body: string
  whatsapp_content_sid: string | null
  is_enabled: boolean
}

const KIND_ORDER: MessageKind[] = [
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

export default function CommunicationsContent({
  settings,
  templates,
}: {
  settings: CommsSettingsView
  templates: TemplateRowView[]
}) {
  const { t } = useI18n()
  const [editing, setEditing] = useState<TemplateRowView | null>(null)
  const [testing, setTesting] = useState<TemplateRowView | null>(null)

  const grouped = useMemo(() => {
    const map = new Map<MessageKind, TemplateRowView[]>()
    for (const tpl of templates) {
      const arr = map.get(tpl.kind) ?? []
      arr.push(tpl)
      map.set(tpl.kind, arr)
    }
    return map
  }, [templates])

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">
          {t.comms.settingsTitle}
        </h1>
        <p className="mt-1 text-sm text-muted">{t.comms.settingsSubtitle}</p>
      </div>

      <section className="space-y-3">
        <header className="flex items-center gap-2">
          <Gear size={16} weight="regular" className="text-muted" />
          <h2 className="text-lg font-semibold text-foreground">
            {t.comms.credsHeader}
          </h2>
        </header>
        <CredsForm settings={settings} action={updateCommsSettingsAction} />
      </section>

      <section className="space-y-3">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PaperPlaneTilt size={16} weight="regular" className="text-muted" />
            <h2 className="text-lg font-semibold text-foreground">
              {t.comms.templatesHeader}
            </h2>
          </div>
        </header>

        {templates.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card p-6 text-center text-sm text-muted">
            {t.comms.templatesEmpty}
          </div>
        ) : (
          <div className="space-y-4">
            {KIND_ORDER.filter((k) => grouped.has(k)).map((k) => (
              <KindGroup
                key={k}
                kind={k}
                rows={grouped.get(k) ?? []}
                onEdit={(row) => setEditing(row)}
                onTest={(row) => setTesting(row)}
              />
            ))}
          </div>
        )}
      </section>

      {editing ? (
        <TemplateEditor
          template={editing}
          onClose={() => setEditing(null)}
          action={updateMessageTemplateAction}
        />
      ) : null}

      {testing ? (
        <TestSendDialog
          template={testing}
          onClose={() => setTesting(null)}
          action={testSendTemplateAction}
        />
      ) : null}
    </div>
  )
}

function KindGroup({
  kind,
  rows,
  onEdit,
  onTest,
}: {
  kind: MessageKind
  rows: TemplateRowView[]
  onEdit: (r: TemplateRowView) => void
  onTest: (r: TemplateRowView) => void
}) {
  const { t } = useI18n()
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-4 py-2">
        <div>
          <div className="text-sm font-semibold text-foreground">
            {t.comms.kindLabels[kind]}
          </div>
          <div className="text-xs text-muted">
            {t.comms.kindDescriptions[kind]}
          </div>
        </div>
      </header>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
            <th className="px-4 py-2">{t.comms.tableLanguage}</th>
            <th className="px-4 py-2">{t.comms.tableChannel}</th>
            <th className="px-4 py-2">{t.comms.tablePreview}</th>
            <th className="px-4 py-2 text-right">{t.comms.tableEnabled}</th>
            <th className="px-4 py-2 text-right">{t.common.actions}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border last:border-0">
              <td className="px-4 py-2 text-foreground">{r.language === 'en' ? 'EN' : 'ES'}</td>
              <td className="px-4 py-2">
                <ChannelBadge channel={r.channel} />
              </td>
              <td className="px-4 py-2 text-muted">
                <span className="line-clamp-1">{r.body.slice(0, 100)}</span>
              </td>
              <td className="px-4 py-2 text-right">
                <ToggleEnabled row={r} />
              </td>
              <td className="px-4 py-2 text-right">
                <button
                  type="button"
                  onClick={() => onTest(r)}
                  className="mr-2 rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground hover:bg-background hover:text-foreground"
                >
                  {t.comms.actionTest}
                </button>
                <button
                  type="button"
                  onClick={() => onEdit(r)}
                  className="rounded-md bg-navy/90 px-2 py-1 text-xs font-medium text-white hover:bg-navy"
                >
                  {t.common.edit}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ChannelBadge({ channel }: { channel: MessageChannel }) {
  const { t } = useI18n()
  const meta: Record<MessageChannel, { icon: React.ReactNode; label: string; tone: string }> = {
    sms: {
      icon: <ChatCircleText size={12} weight="bold" />,
      label: t.comms.channelSms,
      tone: 'border-success/30 bg-success/5 text-success-deep',
    },
    whatsapp: {
      icon: <WhatsappLogo size={12} weight="bold" />,
      label: t.comms.channelWhatsapp,
      tone: 'border-success/30 bg-success/5 text-success-deep',
    },
    email: {
      icon: <EnvelopeSimple size={12} weight="bold" />,
      label: t.comms.channelEmail,
      tone: 'border-border bg-background text-foreground',
    },
  }
  const m = meta[channel]
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs ${m.tone}`}
    >
      {m.icon}
      {m.label}
    </span>
  )
}

function ToggleEnabled({ row }: { row: TemplateRowView }) {
  const { t } = useI18n()
  const [pending, startTransition] = useTransition()
  const [enabled, setEnabled] = useState(row.is_enabled)
  return (
    <button
      type="button"
      onClick={() => {
        const next = !enabled
        setEnabled(next)
        const fd = new FormData()
        fd.set('id', row.id)
        if (next) fd.set('is_enabled', 'on')
        startTransition(async () => {
          const res: ActionResult = await toggleMessageTemplateAction(null, fd)
          if ('error' in res) setEnabled(!next) // revert on failure
        })
      }}
      disabled={pending}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs ${
        enabled
          ? 'bg-success/10 text-success-deep'
          : 'bg-background text-muted'
      }`}
    >
      {enabled ? t.common.yes : t.common.no}
    </button>
  )
}
