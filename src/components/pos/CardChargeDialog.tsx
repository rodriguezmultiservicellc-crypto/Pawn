'use client'

import { useCallback, useEffect, useState } from 'react'
import { CircleNotch, CreditCard, DeviceMobileSpeaker } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { formatMoney } from '@/lib/format/money'
import { READER_POLL_MS, READER_TIMEOUT_MS } from '@/lib/pos/reader'
import {
  cancelReaderChargeAction,
  readerChargeStatusAction,
  retryReaderChargeAction,
  simulateReaderTapAction,
  type StartReaderResult,
} from '@/app/(staff)/pos/sales/new/reader-actions'
import { Modal, Footer } from './Modal'
import { CardSlipFields, EMPTY_SLIP, slipComplete, type CardSlip } from './CardSlipFields'

export type ReaderApproved = { saleId: string; saleNumber: string | null; total: number }

type Phase =
  | { k: 'idle' }
  | { k: 'starting' }
  | { k: 'waiting'; since: number }
  | { k: 'timeout' }
  | { k: 'declined'; message: string | null }
  | { k: 'canceling' }
  | { k: 'canceled' }

/**
 * Charge → Card on the New sale screen.
 *
 *   Card reader  (when the shop paired one, patches/0086) — the sale is saved,
 *                the amount goes to the Stripe reader, and this dialog polls
 *                until the card is approved, declined or the charge is
 *                cancelled. Once the charge started the sale exists, so
 *                closing the dialog CANCELS the charge (never leaves it
 *                hanging) and offers to open the sale.
 *   Card machine (patches/0085) — the clerk runs the card on the shop's own
 *                machine and records the slip.
 */
export function CardChargeDialog({
  total,
  busy,
  reader,
  testMode,
  onRecord,
  onStartReader,
  onReaderApproved,
  onOpenSale,
  onCancel,
}: {
  total: number
  busy?: boolean
  /** The shop's paired reader, or null (then only the card machine is offered). */
  reader: { label: string | null } | null
  testMode: boolean
  onRecord: (slip: CardSlip) => void
  onStartReader: () => Promise<StartReaderResult>
  onReaderApproved: (r: ReaderApproved) => void
  onOpenSale: (saleId: string) => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  const c = t.pos.card
  const errors = t.pos.errors as Record<string, string>
  const [mode, setMode] = useState<'reader' | 'machine'>(reader ? 'reader' : 'machine')
  const [slip, setSlip] = useState<CardSlip>(EMPTY_SLIP)
  const [phase, setPhase] = useState<Phase>({ k: 'idle' })
  const [error, setError] = useState<string | null>(null)
  const [charge, setCharge] = useState<{ paymentId: string; saleId: string; saleNumber: string | null } | null>(null)

  const started = phase.k !== 'idle'
  const readerName = reader?.label ?? c.modeReader

  // ── Poll while waiting ────────────────────────────────────────────────
  useEffect(() => {
    if (phase.k !== 'waiting' || !charge?.paymentId) return
    const { paymentId } = charge
    let stop = false
    const tick = async () => {
      if (stop) return
      if (Date.now() - phase.since > READER_TIMEOUT_MS) {
        setPhase({ k: 'timeout' })
        return
      }
      const r = await readerChargeStatusAction(paymentId).catch(() => null)
      if (stop || !r) return
      if (r.state === 'approved') {
        stop = true
        onReaderApproved({ saleId: r.saleId, saleNumber: r.saleNumber, total: r.total })
      } else if (r.state === 'declined') {
        setPhase({ k: 'declined', message: r.message })
      } else if (r.state === 'canceled') {
        setPhase({ k: 'canceled' })
      } else if (r.state === 'error') {
        setError(errors[r.error] ?? errors.generic)
      }
    }
    const id = setInterval(tick, READER_POLL_MS)
    return () => {
      stop = true
      clearInterval(id)
    }
  }, [phase, charge, onReaderApproved, errors])

  const start = async () => {
    setError(null)
    setPhase({ k: 'starting' })
    const r = await onStartReader()
    if (!r.ok) {
      if (r.saleId) {
        // The sale was saved but the card charge could not start.
        setCharge({ paymentId: '', saleId: r.saleId, saleNumber: null })
        setError(errors[r.error] ?? errors.generic)
        setPhase({ k: 'canceled' })
      } else {
        setError(errors[r.error] ?? errors.generic)
        setPhase({ k: 'idle' })
      }
      return
    }
    setCharge({ paymentId: r.paymentId, saleId: r.saleId, saleNumber: r.saleNumber })
    setPhase({ k: 'waiting', since: Date.now() })
  }

  const retry = async () => {
    if (!charge?.paymentId) return
    setError(null)
    const r = await retryReaderChargeAction(charge.paymentId)
    if (!r.ok) setError(errors[r.error ?? 'generic'] ?? errors.generic)
    setPhase({ k: 'waiting', since: Date.now() })
  }

  const cancelCharge = useCallback(async () => {
    if (!charge?.paymentId) {
      setPhase({ k: 'canceled' })
      return
    }
    setPhase({ k: 'canceling' })
    const r = await cancelReaderChargeAction(charge.paymentId)
    if (!r.ok && r.error === 'readerAlreadyApproved') {
      // Approved at the last second — let the poll finish the sale.
      setError(errors.readerAlreadyApproved)
      setPhase({ k: 'waiting', since: Date.now() })
      return
    }
    setPhase({ k: 'canceled' })
  }, [charge, errors])

  // Closing after the charge started cancels it first; never leave it hanging.
  const close = () => {
    if (phase.k === 'waiting' || phase.k === 'timeout' || phase.k === 'declined') void cancelCharge()
    else if (phase.k === 'canceled' && charge) onOpenSale(charge.saleId)
    else if (phase.k === 'idle') onCancel()
  }

  const title = c.dialogTitle.replace('{total}', formatMoney(total))

  return (
    <Modal title={title} onClose={close} size="lg">
      {reader && !started ? (
        <div role="radiogroup" aria-label={c.modeReader} className="mb-4 inline-flex overflow-hidden rounded-md border border-foreground">
          {(['reader', 'machine'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={`h-11 border-l border-foreground px-4 text-sm font-bold first:border-l-0 ${
                mode === m ? 'bg-foreground text-white' : 'bg-card text-foreground hover:bg-background'
              }`}
            >
              {m === 'reader' ? c.modeReader : c.modeMachine}
            </button>
          ))}
        </div>
      ) : null}

      {error ? (
        <div role="alert" className="mb-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}

      {mode === 'machine' ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (slipComplete(slip) && !busy) onRecord(slip)
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
              disabled={!slipComplete(slip) || busy}
              className="inline-flex h-11 items-center gap-2 rounded-md bg-gold px-5 text-sm font-bold text-navy transition-colors hover:bg-gold-2 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <CreditCard size={16} weight="bold" />
              {c.record}
            </button>
          </Footer>
        </form>
      ) : (
        <div>
          <ReaderStatus phase={phase} readerName={readerName} saleNumber={charge?.saleNumber ?? null} />
          <Footer>
            {phase.k === 'idle' ? (
              <>
                <button
                  type="button"
                  onClick={onCancel}
                  className="h-11 rounded-md border border-border bg-card px-4 text-sm font-semibold text-foreground hover:bg-background"
                >
                  {t.common.cancel}
                </button>
                <button
                  type="button"
                  autoFocus
                  disabled={busy}
                  onClick={() => void start()}
                  className="inline-flex h-11 items-center gap-2 rounded-md bg-gold px-5 text-sm font-bold text-navy transition-colors hover:bg-gold-2 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <DeviceMobileSpeaker size={16} weight="bold" />
                  {c.sendToReader.replace('{total}', formatMoney(total))}
                </button>
              </>
            ) : null}

            {phase.k === 'waiting' || phase.k === 'timeout' || phase.k === 'declined' ? (
              <>
                {testMode && phase.k === 'waiting' && charge?.paymentId ? (
                  <button
                    type="button"
                    onClick={() => void simulateReaderTapAction(charge!.paymentId)}
                    className="mr-auto h-11 rounded-md border border-info/40 px-4 text-sm font-semibold text-info hover:bg-info/5"
                  >
                    {c.simulateTap}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => void cancelCharge()}
                  className="h-11 rounded-md border border-border bg-card px-4 text-sm font-semibold text-danger hover:bg-background"
                >
                  {c.cancelCharge}
                </button>
                {phase.k === 'declined' ? (
                  <button
                    type="button"
                    autoFocus
                    onClick={() => void retry()}
                    className="h-11 rounded-md bg-gold px-5 text-sm font-bold text-navy transition-colors hover:bg-gold-2"
                  >
                    {c.tryAgain}
                  </button>
                ) : null}
                {phase.k === 'timeout' ? (
                  <button
                    type="button"
                    autoFocus
                    onClick={() => setPhase({ k: 'waiting', since: Date.now() })}
                    className="h-11 rounded-md bg-gold px-5 text-sm font-bold text-navy transition-colors hover:bg-gold-2"
                  >
                    {c.keepWaiting}
                  </button>
                ) : null}
              </>
            ) : null}

            {phase.k === 'canceled' && charge ? (
              <button
                type="button"
                autoFocus
                onClick={() => onOpenSale(charge!.saleId)}
                className="h-11 rounded-md bg-gold px-5 text-sm font-bold text-navy transition-colors hover:bg-gold-2"
              >
                {c.openSale}
              </button>
            ) : null}
          </Footer>
        </div>
      )}
    </Modal>
  )
}

function ReaderStatus({ phase, readerName, saleNumber }: { phase: Phase; readerName: string; saleNumber: string | null }) {
  const { t } = useI18n()
  const c = t.pos.card
  if (phase.k === 'idle') return null
  const spinning = phase.k === 'starting' || phase.k === 'waiting' || phase.k === 'canceling'
  const text =
    phase.k === 'starting' || phase.k === 'canceling'
      ? c.readerStarting
      : phase.k === 'waiting'
        ? c.readerWaiting.replace('{reader}', readerName)
        : phase.k === 'timeout'
          ? c.readerTimeout
          : phase.k === 'declined'
            ? phase.message
              ? c.readerDeclined.replace('{message}', phase.message)
              : c.readerDeclinedGeneric
            : c.readerCanceled.replace('{number}', saleNumber ?? '')
  const tone = phase.k === 'declined' ? 'text-danger' : phase.k === 'timeout' ? 'text-warning' : 'text-foreground'
  return (
    <div role="status" aria-live="polite" className={`flex items-center gap-3 rounded-xl bg-background px-4 py-4 text-sm ${tone}`}>
      {spinning ? <CircleNotch size={22} className="shrink-0 animate-spin text-blue" /> : null}
      <span>{text}</span>
    </div>
  )
}
