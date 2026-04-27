'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Scan, X } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { parseDriverLicense, type DLInfo } from '@/lib/dl-parser'

interface Props {
  onResult: (info: DLInfo, rawPayload: string) => void
  label?: string
  className?: string
}

/**
 * USB PDF417 driver-license scanner button + modal.
 *
 * Click "Scan ID" → modal opens with a focused textarea → owner scans the
 * BACK of a US driver license with a USB PDF417 HID-keyboard scanner →
 * 400ms after typing stops, the AAMVA payload is parsed → onResult fires.
 *
 * Tested with Symcode MJ-2030. Other compatible scanners: Tera HW0001,
 * NADAMOO 2D, Inateck BCST. Scanner must read the PDF417 barcode on the
 * back, not the magstripe-replacement barcode on the front.
 *
 * Raw AAMVA payload is passed alongside the parsed info so callers can
 * stash it for compliance audits if desired.
 */
export default function DlScanner({
  onResult,
  label,
  className = '',
}: Props) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [buffer, setBuffer] = useState('')
  const [error, setError] = useState('')
  const taRef = useRef<HTMLTextAreaElement>(null)
  const idleRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (open && taRef.current) {
      taRef.current.focus()
      setBuffer('')
      setError('')
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    if (idleRef.current) clearTimeout(idleRef.current)
    const trimmed = buffer.trim()
    if (trimmed.length < 20) return
    idleRef.current = setTimeout(() => handleParse(buffer), 400)
    return () => {
      if (idleRef.current) clearTimeout(idleRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buffer, open])

  function handleParse(raw: string) {
    const text = raw.trim()
    if (!text) {
      setError(t.dlScanner.errorNoData)
      return
    }
    try {
      const info = parseDriverLicense(text)
      if (!info.lastName && !info.firstName && !info.licenseNumber) {
        setError(t.dlScanner.errorBadRead)
        return
      }
      onResult(info, text)
      setOpen(false)
    } catch (e) {
      setError(`${t.dlScanner.errorParse}: ${(e as Error).message}`)
    }
  }

  const button = (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className={
        className ||
        'inline-flex items-center gap-1.5 rounded-md border border-hairline bg-canvas px-3 py-2 text-sm font-medium text-ink hover:border-ink'
      }
    >
      <Scan size={14} weight="bold" />
      {label ?? t.dlScanner.button}
    </button>
  )

  if (!open || typeof document === 'undefined') return button

  return (
    <>
      {button}
      {createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-lg rounded-lg border border-hairline bg-canvas p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="mb-4 flex items-center justify-between">
              <h3 className="inline-flex items-center gap-2 text-base font-semibold text-ink">
                <Scan size={16} weight="bold" />
                {t.dlScanner.modalTitle}
              </h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-1 text-ash hover:bg-cloud hover:text-ink"
                aria-label="close"
              >
                <X size={16} weight="bold" />
              </button>
            </header>

            <p className="mb-3 text-xs text-ash">{t.dlScanner.help}</p>

            <textarea
              ref={taRef}
              value={buffer}
              onChange={(e) => setBuffer(e.target.value)}
              rows={6}
              placeholder={t.dlScanner.placeholder}
              className="block w-full resize-none rounded-md border border-hairline bg-canvas px-3 py-2 font-mono text-xs text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
            />

            {error ? (
              <div className="mt-3 rounded-md border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
                {error}
              </div>
            ) : null}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-hairline bg-canvas px-4 py-2 text-sm text-ink hover:border-ink"
              >
                {t.common.cancel}
              </button>
              <button
                type="button"
                onClick={() => handleParse(buffer)}
                disabled={!buffer.trim()}
                className="rounded-md bg-rausch px-4 py-2 text-sm font-medium text-canvas hover:bg-rausch-deep disabled:opacity-50"
              >
                {t.dlScanner.parse}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
