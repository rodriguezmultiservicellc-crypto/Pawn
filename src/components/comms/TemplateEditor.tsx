'use client'

import { useMemo, useState, useTransition } from 'react'
import { FloppyDisk, Eye, X } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import type { MessageChannel, MessageKind } from '@/types/database-aliases'

const SAMPLE_VARS: Record<string, string> = {
  shop_name: 'Acme Jewelers',
  customer_first_name: 'Jane',
  customer_last_name: 'Doe',
  ticket_number: 'PT-000123',
  due_date: '2026-05-15',
  amount: '$245.00',
  portal_link: 'https://pawn.example/portal/loans/sample',
  body: 'This is a custom message body.',
}

function renderPreview(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const v = vars[key]
    return v == null ? '' : v
  })
}

export type TemplateEditorRow = {
  id: string
  kind: MessageKind
  language: 'en' | 'es'
  channel: MessageChannel
  subject: string | null
  body: string
  whatsapp_content_sid: string | null
  is_enabled: boolean
}

export function TemplateEditor({
  template,
  onClose,
  action,
}: {
  template: TemplateEditorRow
  onClose: () => void
  action: (
    prev: { ok: true } | { error: string; fieldErrors?: Record<string, string> } | null,
    formData: FormData,
  ) => Promise<{ ok: true } | { error: string; fieldErrors?: Record<string, string> }>
}) {
  const { t } = useI18n()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [subject, setSubject] = useState<string>(template.subject ?? '')
  const [body, setBody] = useState<string>(template.body)
  const [contentSid, setContentSid] = useState<string>(template.whatsapp_content_sid ?? '')
  const [isEnabled, setIsEnabled] = useState<boolean>(template.is_enabled)

  const preview = useMemo(() => renderPreview(body, SAMPLE_VARS), [body])
  const subjectPreview = useMemo(
    () => renderPreview(subject, SAMPLE_VARS),
    [subject],
  )

  function submit() {
    setError(null)
    const fd = new FormData()
    fd.set('id', template.id)
    if (template.channel === 'email') fd.set('subject', subject)
    fd.set('body', body)
    if (template.channel === 'whatsapp') fd.set('whatsapp_content_sid', contentSid)
    if (isEnabled) fd.set('is_enabled', 'on')
    startTransition(async () => {
      const res = await action(null, fd)
      if ('error' in res) setError(res.error)
      else onClose()
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-3xl rounded-xl border border-border bg-card p-5 shadow-lg">
        <header className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-foreground">
              {t.comms.kindLabels[template.kind]}{' '}
              <span className="text-muted">
                · {template.language === 'en' ? 'EN' : 'ES'} · {template.channel}
              </span>
            </h3>
            <p className="text-xs text-muted">{t.comms.editorHelp}</p>
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

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            {template.channel === 'email' ? (
              <label className="block space-y-1">
                <span className="text-sm font-medium text-foreground">
                  {t.comms.editorSubject}
                </span>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
                />
              </label>
            ) : null}

            {template.channel === 'whatsapp' ? (
              <label className="block space-y-1">
                <span className="text-sm font-medium text-foreground">
                  {t.comms.editorContentSid}
                </span>
                <input
                  type="text"
                  value={contentSid}
                  onChange={(e) => setContentSid(e.target.value)}
                  placeholder="HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  className="block w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-xs text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
                />
                <span className="block text-xs text-muted">
                  {t.comms.editorContentSidHelp}
                </span>
              </label>
            ) : null}

            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">
                {t.comms.editorBody}
              </span>
              <textarea
                rows={10}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
              />
              <span className="block text-xs text-muted">
                {t.comms.editorBodyHelp}
              </span>
            </label>

            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={isEnabled}
                onChange={(e) => setIsEnabled(e.target.checked)}
              />
              {t.comms.editorEnabled}
            </label>
          </div>

          <div className="space-y-2 rounded-md border border-border bg-background/30 p-3">
            <div className="flex items-center gap-1 text-xs font-semibold text-foreground">
              <Eye size={12} weight="bold" />
              {t.comms.previewHeader}
            </div>
            {template.channel === 'email' ? (
              <div className="text-sm">
                <div className="text-xs text-muted">
                  {t.comms.editorSubject}
                </div>
                <div className="font-medium text-foreground">{subjectPreview || '—'}</div>
              </div>
            ) : null}
            <div className="whitespace-pre-wrap rounded-md border border-border bg-card p-3 text-sm text-foreground">
              {preview || '—'}
            </div>
            <div className="text-xs text-muted">{t.comms.previewVarsHelp}</div>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border bg-card px-4 py-2 text-sm text-foreground hover:bg-background hover:text-foreground"
          >
            {t.common.cancel}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={submit}
            className="inline-flex items-center gap-1 rounded-md bg-gold px-4 py-2 text-sm font-medium text-navy hover:bg-gold-2 disabled:opacity-50"
          >
            <FloppyDisk size={14} weight="bold" />
            {pending ? t.common.saving : t.common.save}
          </button>
        </div>
      </div>
    </div>
  )
}
