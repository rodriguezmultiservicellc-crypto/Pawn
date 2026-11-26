'use client'

import { useTransition } from 'react'
import { Printer } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { Modal } from '@/components/pos/Modal'
import { printTicketAction } from '@/app/(staff)/pawn/[id]/actions'

/**
 * "Ticket saved — print it now" (Eddy, 2026-11-25: a new pawn ticket goes
 * to the Pawns list, and prints right away). Shown on /pawn?print=<loan id>
 * after createLoanAction. Print locks the ticket (printTicketAction, rule 14)
 * and opens its PDF in a new tab; Later leaves it unprinted — the ticket
 * page's Print button does it then.
 *
 * Print is a click, not an effect: the browser only lets a click open the
 * ticket's tab. Enter prints.
 */
export function PrintNewTicketPrompt({
  loanId,
  ticketNumber,
  onClose,
}: {
  loanId: string
  ticketNumber: string
  onClose: () => void
}) {
  const { t } = useI18n()
  const a = t.pawn.actions
  const [pending, startTransition] = useTransition()

  function print() {
    startTransition(async () => {
      const res = await printTicketAction(loanId)
      if (!res.error) {
        window.open(`/api/print/loan/${loanId}`, '_blank', 'noopener,noreferrer')
      }
      onClose()
    })
  }

  return (
    <Modal title={a.printNowTitle} onClose={onClose}>
      <p className="text-sm text-text-secondary">
        {a.printNowBody.replace('{number}', ticketNumber)}
      </p>
      <div className="mt-5 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-11 items-center rounded-xl border border-border bg-card px-4 text-sm font-semibold text-foreground hover:bg-background"
        >
          {a.printNowLater}
        </button>
        <button
          type="button"
          autoFocus
          disabled={pending}
          onClick={print}
          className="inline-flex h-11 items-center gap-2 rounded-xl bg-gold px-5 text-sm font-bold text-navy transition-all hover:-translate-y-0.5 hover:bg-gold-2 hover:shadow-lg disabled:opacity-50"
        >
          <Printer size={16} weight="bold" />
          {a.printTicket}
        </button>
      </div>
    </Modal>
  )
}
