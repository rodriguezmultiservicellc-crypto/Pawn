'use client'

import { useEffect, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { DeviceMobile, QrCode } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { Modal } from '@/components/pos/Modal'
import {
  cancelDraftHandoffAction,
  draftHandoffStatusAction,
  startDraftHandoffAction,
} from '@/app/(staff)/pawn/drafts/handoff-actions'

const POLL_MS = 2500

/**
 * "Continue on another device" on New pawn (Eddy, 2026-11-26). Saves the
 * ticket as a draft and shows a QR code; the iPad / phone / laptop that scans
 * it opens the same ticket, and this screen closes its copy (onMoved) so one
 * ticket is never on two screens. Cancel keeps it here and the code stops
 * working. lib/pawn/draft-handoff has the rules.
 */
export function DraftHandoffButton({
  formId,
  disabled,
  className,
  onDraftSaved,
  onMoved,
}: {
  formId: string
  disabled: boolean
  className: string
  /** The draft the ticket was saved as: the form keeps it in draft_id. */
  onDraftSaved: (draftId: string) => void
  onMoved: () => void
}) {
  const { t } = useI18n()
  const h = t.pawn.new_.handoff
  const [pending, startTransition] = useTransition()
  const [shown, setShown] = useState<{
    draftId: string
    qrSvg: string
    minutes: number
  } | null>(null)
  const [expired, setExpired] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function start() {
    const formEl = document.getElementById(formId) as HTMLFormElement | null
    if (!formEl) return
    const fd = new FormData(formEl)
    setError(null)
    startTransition(async () => {
      const res = await startDraftHandoffAction(fd)
      if (!res.ok) {
        setError(res.error === 'no_customer' ? h.noCustomer : h.failed)
        return
      }
      onDraftSaved(res.draftId)
      setExpired(false)
      setShown({ draftId: res.draftId, qrSvg: res.qrSvg, minutes: res.minutes })
    })
  }

  // While the code shows: has the other device opened it?
  useEffect(() => {
    if (!shown) return
    let live = true
    const timer = window.setInterval(() => {
      void draftHandoffStatusAction(shown.draftId).then((status) => {
        if (!live) return
        if (status === 'claimed' || status === 'gone') {
          window.clearInterval(timer)
          setShown(null)
          onMoved()
        } else if (status === 'expired') {
          window.clearInterval(timer)
          setExpired(true)
        }
      })
    }, POLL_MS)
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [shown, onMoved])

  function keepHere() {
    if (shown) void cancelDraftHandoffAction(shown.draftId)
    setShown(null)
    setExpired(false)
  }

  return (
    <>
      <button type="button" onClick={start} disabled={disabled || pending} className={className}>
        <QrCode size={16} weight="bold" />
        {pending ? h.preparing : h.button}
      </button>
      {error ? <p className="text-center text-xs text-danger">{error}</p> : null}
      {shown
        ? createPortal(
            <Modal title={h.title} onClose={keepHere}>
              {expired ? (
                <p className="text-sm text-text-secondary">{h.expired}</p>
              ) : (
                <>
                  <p className="text-sm text-text-secondary">
                    {h.body.replace('{minutes}', String(shown.minutes))}
                  </p>
                  {/* Our own server drew this SVG from our own link; a data
                      URL, so next/image has nothing to optimize. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`data:image/svg+xml;utf8,${encodeURIComponent(shown.qrSvg)}`}
                    alt={h.qrAlt}
                    className="mx-auto my-4 h-64 w-64 rounded-md border border-border bg-white p-2"
                  />
                  <p className="flex items-center justify-center gap-2 text-sm text-muted">
                    <DeviceMobile size={16} />
                    {h.waiting}
                  </p>
                </>
              )}
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={keepHere}
                  className="inline-flex h-11 items-center rounded-xl border border-border bg-card px-4 text-sm font-semibold text-foreground hover:bg-background"
                >
                  {h.keepHere}
                </button>
                {expired ? (
                  <button
                    type="button"
                    onClick={start}
                    className="inline-flex h-11 items-center rounded-xl bg-gold px-5 text-sm font-bold text-navy hover:bg-gold-2"
                  >
                    {h.newCode}
                  </button>
                ) : null}
              </div>
            </Modal>,
            document.body,
          )
        : null}
    </>
  )
}

/** What this screen shows once the ticket moved to another device. */
export function TicketMovedNotice() {
  const { t } = useI18n()
  const h = t.pawn.new_.handoff
  return (
    <div className="mx-auto max-w-lg rounded-xl border border-border bg-card p-8 text-center">
      <DeviceMobile size={36} weight="light" className="mx-auto mb-3 text-muted" />
      <h2 className="font-display text-xl font-bold text-foreground">{h.movedTitle}</h2>
      <p className="mt-2 text-sm text-text-secondary">{h.movedBody}</p>
      <div className="mt-6 flex justify-center gap-2">
        <Link
          href="/pawn"
          className="inline-flex h-11 items-center rounded-xl border border-border bg-card px-4 text-sm font-semibold text-foreground hover:bg-background"
        >
          {h.goPawns}
        </Link>
        {/* A fresh, empty ticket: a full load, not this screen's state. */}
        <button
          type="button"
          onClick={() => window.location.assign('/pawn/new')}
          className="inline-flex h-11 items-center rounded-xl bg-gold px-5 text-sm font-bold text-navy hover:bg-gold-2"
        >
          {h.newTicket}
        </button>
      </div>
    </div>
  )
}
