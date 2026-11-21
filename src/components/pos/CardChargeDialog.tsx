'use client'

import { useState } from 'react'
import { CreditCard } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { formatMoney } from '@/lib/format/money'
import { Modal, Footer } from './Modal'
import { CardSlipFields, EMPTY_SLIP, slipComplete, type CardSlip } from './CardSlipFields'

/**
 * Charge → Card on the New sale screen. The clerk runs the card on the shop's
 * card machine, then records the slip here; the sale is saved, paid and
 * completed in one request (createSaleAction, tender 'card').
 */
export function CardChargeDialog({
  total,
  busy,
  onCancel,
  onRecord,
}: {
  total: number
  busy?: boolean
  onCancel: () => void
  onRecord: (slip: CardSlip) => void
}) {
  const { t } = useI18n()
  const c = t.pos.card
  const [slip, setSlip] = useState<CardSlip>(EMPTY_SLIP)
  const ready = slipComplete(slip)

  return (
    <Modal title={c.dialogTitle.replace('{total}', formatMoney(total))} onClose={onCancel} size="lg">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (ready && !busy) onRecord(slip)
        }}
      >
        <CardSlipFields value={slip} onChange={setSlip} autoFocus />
        <Footer>
          <button
            type="button"
            onClick={onCancel}
            className="h-11 rounded-md border border-border bg-card px-4 text-sm font-semibold text-foreground hover:bg-background"
          >
            {t.common.cancel}
          </button>
          <button
            type="submit"
            disabled={!ready || busy}
            className="inline-flex h-11 items-center gap-2 rounded-md bg-gold px-5 text-sm font-bold text-navy transition-colors hover:bg-gold-2 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <CreditCard size={16} weight="bold" />
            {c.record}
          </button>
        </Footer>
      </form>
    </Modal>
  )
}
