'use client'

import { useState, useTransition } from 'react'
import { CheckCircle, PaperPlaneTilt, X } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import type { MessageChannel, MessageKind } from '@/types/database-aliases'

export type TestSendTemplate = {
  id: string
  kind: MessageKind
  language: 'en' | 'es'
  channel: MessageChannel
}

export function TestSendDialog({
  template,
  onClose,
  action,
}: {
  template: TestSendTemplate
  onClose: () => void
  action: (
    prev: { ok: true } | { error: string; fieldErrors?: Record<string, string> } | null,
    formData: FormData,
  ) => Promise<{ ok: true } | { error: string; fieldErrors?: Record<string, string> }>
}) {
  const { t } = useI18n()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [to, setTo] = useState<string>('')

  const placeholder = template.channel === 'email' ? 'someone@example.com' : '+18135551234'

  function submit() {
    setError(null)
    setSuccess(false)
    const fd = new FormData()
    fd.set('template_id', template.id)
    fd.set('to', to)
    startTransition(async () => {
      const res = await action(null, fd)
      if ('error' in res) setError(res.error)
      else setSuccess(true)
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-lg border border-hairline bg-canvas p-5 shadow-lg">
        <header className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-ink">
            {t.comms.testSendTitle}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-ash hover:bg-cloud hover:text-ink"
            aria-label="close"
          >
            <X size={16} weight="bold" />
          </button>
        </header>

        <p className="mb-3 text-xs text-ash">{t.comms.testSendBody}</p>

        {error ? (
          <div className="mb-3 rounded-md border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">
            {error}
          </div>
        ) : null}

        {success ? (
          <div className="mb-3 inline-flex items-center gap-1 rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm text-success-deep">
            <CheckCircle size={14} weight="bold" />
            {t.comms.testSendSuccess}
          </div>
        ) : null}

        <label className="block space-y-1">
          <span className="text-sm font-medium text-ink">
            {t.comms.testSendTo}
          </span>
          <input
            type={template.channel === 'email' ? 'email' : 'tel'}
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder={placeholder}
            className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
          />
        </label>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-hairline bg-canvas px-4 py-2 text-sm text-ink hover:border-ink"
          >
            {t.common.close}
          </button>
          <button
            type="button"
            disabled={pending || !to.trim()}
            onClick={submit}
            className="inline-flex items-center gap-1 rounded-md bg-rausch px-4 py-2 text-sm font-medium text-canvas hover:bg-rausch-deep disabled:opacity-50"
          >
            <PaperPlaneTilt size={14} weight="bold" />
            {pending ? t.common.saving : t.comms.testSendSubmit}
          </button>
        </div>
      </div>
    </div>
  )
}
