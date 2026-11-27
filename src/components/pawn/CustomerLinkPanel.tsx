'use client'

import { useState, useTransition } from 'react'
import { ArrowSquareOut, ChatText, Copy, LinkSimple } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { FOCUS, OUTLINE_BTN } from '@/lib/ui/ledger'
import {
  ensurePawnLinkAction,
  newPawnLinkAction,
  revokePawnLinkAction,
  sendPawnLinkAction,
  type PawnLinkResult,
} from '@/app/(staff)/pawn/[id]/link-actions'

/**
 * "Customer link" on a pawn ticket (patches/0127): the customer's own page
 * (/p/<token>) with the due date, the amount to pick up today, the items
 * and the payments. Made the first time it is copied, opened or sent.
 */
export function CustomerLinkPanel({ loanId, initialLink }: { loanId: string; initialLink: string | null }) {
  const { t } = useI18n()
  const tl = t.pawn.detail.customerLink
  const [link, setLink] = useState(initialLink)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [pending, start] = useTransition()

  const errText = (code: string) => (tl.errors as Record<string, string>)[code] ?? tl.errors.failed

  function run(action: (id: string) => Promise<PawnLinkResult>, onOk: (r: PawnLinkResult) => void) {
    setMsg(null)
    start(async () => {
      const r = await action(loanId)
      if (r.link !== undefined) setLink(r.link)
      if (r.error) setMsg({ tone: 'error', text: errText(r.error) })
      else onOk(r)
    })
  }

  return (
    <section className="mt-3 rounded-xl border border-border bg-card p-4" title={tl.help}>
      <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
        <LinkSimple size={16} weight="bold" />
        {tl.title}
      </h2>
      <p className="mt-1 text-xs text-text-secondary">{tl.help}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => run(sendPawnLinkAction, () => setMsg({ tone: 'ok', text: tl.sent }))}
          className={`${OUTLINE_BTN} min-h-9`}
        >
          <ChatText size={14} weight="bold" />
          {tl.send}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(ensurePawnLinkAction, (r) => {
              if (!r.link) return
              void navigator.clipboard.writeText(r.link).then(
                () => setMsg({ tone: 'ok', text: tl.copied }),
                () => setMsg({ tone: 'ok', text: r.link ?? '' }),
              )
            })
          }
          className={`${OUTLINE_BTN} min-h-9`}
        >
          <Copy size={14} weight="bold" />
          {tl.copy}
        </button>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
        {link ? (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex min-h-9 items-center gap-1 rounded-md font-semibold text-blue hover:underline ${FOCUS}`}
          >
            {tl.open}
            <ArrowSquareOut size={13} weight="bold" />
          </a>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(ensurePawnLinkAction, (r) => {
                if (r.link) window.open(r.link, '_blank', 'noopener,noreferrer')
              })
            }
            className={`inline-flex min-h-9 items-center gap-1 rounded-md font-semibold text-blue hover:underline disabled:opacity-50 ${FOCUS}`}
          >
            {tl.open}
            <ArrowSquareOut size={13} weight="bold" />
          </button>
        )}
        {link ? (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (!window.confirm(tl.newConfirm)) return
                run(newPawnLinkAction, () => setMsg({ tone: 'ok', text: tl.renewed }))
              }}
              className={`inline-flex min-h-9 items-center rounded-md font-semibold text-blue hover:underline disabled:opacity-50 ${FOCUS}`}
            >
              {tl.renew}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (!window.confirm(tl.revokeConfirm)) return
                run(revokePawnLinkAction, () => setMsg({ tone: 'ok', text: tl.revoked }))
              }}
              className={`inline-flex min-h-9 items-center rounded-md font-semibold text-danger hover:underline disabled:opacity-50 ${FOCUS}`}
            >
              {tl.revoke}
            </button>
          </>
        ) : null}
      </div>

      {msg ? (
        <p role="status" className={`mt-2 break-all text-xs font-semibold ${msg.tone === 'ok' ? 'text-success' : 'text-danger'}`}>
          {msg.text}
        </p>
      ) : null}
    </section>
  )
}
