'use client'

import { useState } from 'react'
import { FileText, Receipt } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { formatMoney } from '@/lib/format/money'
import { printHtmlFromUrl } from '@/lib/pos/print-frame'
import { isReceiptFormat, type ReceiptFormat } from '@/lib/pos/receipt-format'
import { Modal } from './Modal'

const LAST_FORMAT_KEY = 'pos.receipt.lastFormat'

function readLastFormat(): ReceiptFormat {
  if (typeof window === 'undefined') return 'thermal'
  try {
    const v = window.localStorage.getItem(LAST_FORMAT_KEY)
    return isReceiptFormat(v) ? v : 'thermal'
  } catch {
    return 'thermal'
  }
}

/**
 * "Print the receipt?" — opens on its own the moment a sale is paid, and
 * from the sale page's Print receipt button. Two printers: Letter (full
 * page) or Thermal (40-column receipt printer). The receipt is an HTML page
 * printed from a hidden frame — never a PDF.
 *
 * The last format used is remembered on this computer and gets the focus,
 * so the clerk can just press Enter at the next sale.
 */
export function PrintReceiptDialog({
  saleId,
  saleNumber,
  total,
  layawayNumber,
  onClose,
}: {
  saleId: string
  saleNumber: string | null
  total: number
  /** A layaway's receipt (its sale's receipt carries the layaway terms):
   *  the dialog names the layaway instead of the sale. */
  layawayNumber?: string
  onClose: () => void
}) {
  const { t } = useI18n()
  const [busy, setBusy] = useState<ReceiptFormat | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The dialog only ever mounts after a click or a completed payment, never
  // in the server render, so reading localStorage up front is safe.
  const [preferred] = useState<ReceiptFormat>(readLastFormat)

  async function print(format: ReceiptFormat) {
    setError(null)
    setBusy(format)
    try {
      window.localStorage.setItem(LAST_FORMAT_KEY, format)
    } catch {
      /* remembering the choice is a convenience only */
    }
    try {
      await printHtmlFromUrl(`/api/print/sale/${saleId}/receipt?format=${format}`)
      onClose()
    } catch {
      setError(t.pos.receiptPrint.failed)
      setBusy(null)
    }
  }

  const options: Array<{
    format: ReceiptFormat
    label: string
    help: string
    icon: React.ReactNode
  }> = [
    {
      format: 'letter',
      label: t.pos.receiptPrint.letter,
      help: t.pos.receiptPrint.letterHelp,
      icon: <FileText size={28} weight="bold" />,
    },
    {
      format: 'thermal',
      label: t.pos.receiptPrint.thermal,
      help: t.pos.receiptPrint.thermalHelp,
      icon: <Receipt size={28} weight="bold" />,
    },
  ]

  return (
    <Modal title={t.pos.receiptPrint.title} onClose={onClose}>
      <p className="mb-4 text-sm text-text-secondary">
        {(layawayNumber ? t.pos.receiptPrint.bodyLayaway : t.pos.receiptPrint.body)
          .replace('{number}', layawayNumber ?? saleNumber ?? '')
          .replace('{total}', formatMoney(total))}
      </p>
      {error ? (
        <div role="alert" className="mb-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        {options.map((o) => {
          const primary = o.format === preferred
          return (
            <button
              key={o.format}
              type="button"
              autoFocus={primary}
              disabled={busy !== null}
              onClick={() => print(o.format)}
              className={`flex min-h-32 flex-col items-center justify-center gap-2 rounded-xl border-2 px-4 py-4 text-center transition-all hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-blue disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none ${
                primary
                  ? 'border-gold bg-gold text-navy hover:bg-gold-2'
                  : 'border-border bg-card text-foreground hover:bg-background'
              }`}
            >
              {o.icon}
              <span className="text-base font-bold">
                {busy === o.format ? t.pos.receiptPrint.sending : o.label}
              </span>
              <span className={`text-xs ${primary ? 'text-navy/80' : 'text-muted'}`}>{o.help}</span>
            </button>
          )
        })}
      </div>
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-11 items-center rounded-xl border border-border bg-card px-4 text-sm font-semibold text-foreground hover:bg-background"
        >
          {t.pos.receiptPrint.skip}
        </button>
      </div>
    </Modal>
  )
}
