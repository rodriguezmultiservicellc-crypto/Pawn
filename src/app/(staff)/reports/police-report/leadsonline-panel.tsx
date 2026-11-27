'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { PaperPlaneTilt } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { EnvBadge } from '@/components/leadsonline/EnvBadge'
import { sendToLeadsOnlineAction } from './actions'

export type LeadsOnlineTicketView = {
  /** compliance_log id */
  id: string
  ticketType: 'Pawn' | 'Buy'
  ticketNumber: string
  /** Shop time, already written. */
  when: string
  customer: string
  voided: boolean
  /** The last send to the shop's environment; null = never sent there. */
  last: { ok: boolean; text: string; at: string } | null
}

/** Most tickets per press (= LEADSONLINE_SEND_MAX on the server). */
const SEND_MAX = 25

export function LeadsOnlinePanel({
  configured,
  canSend,
  env,
  tickets,
}: {
  configured: boolean
  canSend: boolean
  env: 'sandbox' | 'production'
  tickets: LeadsOnlineTicketView[]
}) {
  const { t } = useI18n()
  const tl = t.leadsonline.send
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const notAccepted = tickets.filter((x) => !x.last?.ok)

  function send(ids: string[]) {
    if (ids.length === 0) return
    setBusyIds(new Set(ids))
    setMessage(null)
    startTransition(async () => {
      const r = await sendToLeadsOnlineAction(ids)
      setBusyIds(new Set())
      if (!r.ok) {
        setMessage({ tone: 'error', text: (t.leadsonline.errors as Record<string, string>)[r.error] ?? r.error })
      } else {
        const good = r.results.filter((x) => x.ok).length
        setMessage({
          tone: good === r.results.length ? 'ok' : 'error',
          text: tl.result.replace('{ok}', String(good)).replace('{bad}', String(r.results.length - good)),
        })
      }
      router.refresh()
    })
  }

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 text-base font-bold text-foreground">
            <PaperPlaneTilt size={18} weight="bold" />
            {tl.title}
            {configured ? <EnvBadge env={env} /> : null}
          </h2>
          <p className="text-xs text-text-secondary">{env === 'production' ? tl.helpProduction : tl.helpSandbox}</p>
        </div>
        {configured && canSend ? (
          <button
            type="button"
            disabled={pending || notAccepted.length === 0}
            onClick={() => send(notAccepted.slice(0, SEND_MAX).map((x) => x.id))}
            className="inline-flex items-center gap-2 rounded-xl border border-navy bg-navy px-4 py-2 text-sm font-bold text-white hover:bg-navy/90 disabled:opacity-50"
          >
            {pending ? tl.sending : tl.sendAll.replace('{n}', String(Math.min(SEND_MAX, notAccepted.length)))}
          </button>
        ) : null}
      </div>

      {!configured ? (
        <p className="text-sm text-text-secondary">
          {tl.setup}{' '}
          <Link href="/settings/integrations/leadsonline" className="font-semibold text-blue hover:underline">
            {tl.setupLink}
          </Link>
        </p>
      ) : !canSend ? (
        <p className="text-sm text-text-secondary">{tl.managerOnly}</p>
      ) : null}

      {message ? (
        <p role="status" className={`text-sm font-semibold ${message.tone === 'ok' ? 'text-success' : 'text-danger'}`}>
          {message.text}
        </p>
      ) : null}

      {configured && tickets.length > 0 ? (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-text-secondary">
              <tr>
                <th className="py-2 pr-3 font-semibold">{tl.colTicket}</th>
                <th className="py-2 pr-3 font-semibold">{tl.colWhen}</th>
                <th className="py-2 pr-3 font-semibold">{tl.colCustomer}</th>
                <th className="py-2 pr-3 font-semibold">{tl.colStatus}</th>
                <th className="py-2 font-semibold">
                  <span className="sr-only">{t.common.actions}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((x) => (
                <tr key={x.id} className="border-t border-border align-top">
                  <td className="py-2 pr-3 font-mono">
                    {x.ticketType} {x.ticketNumber}
                    {x.voided ? (
                      <span className="ml-1 rounded bg-danger/10 px-1 text-[11px] font-bold text-danger">{t.leadsonline.voidTag}</span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs">{x.when}</td>
                  <td className="py-2 pr-3">{x.customer || '—'}</td>
                  <td className="py-2 pr-3">
                    {x.last == null ? (
                      <span className="text-text-secondary">{tl.never}</span>
                    ) : x.last.ok ? (
                      <span className="font-semibold text-success">
                        {t.leadsonline.resultOk} · <span className="font-mono text-xs font-normal">{x.last.at}</span>
                      </span>
                    ) : (
                      <span className="text-danger">{x.last.text}</span>
                    )}
                  </td>
                  <td className="py-1 text-right">
                    {canSend ? (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => send([x.id])}
                        className="inline-flex min-h-9 items-center rounded-md px-2 text-sm font-bold text-blue hover:underline disabled:opacity-50"
                      >
                        {busyIds.has(x.id) ? tl.sending : x.last?.ok ? tl.resend : tl.sendOne}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : configured ? (
        <p className="text-sm text-text-secondary">{t.reports.empty}</p>
      ) : null}
    </section>
  )
}
