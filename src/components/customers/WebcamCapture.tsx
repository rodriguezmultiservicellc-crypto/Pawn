'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Camera, X, ArrowsClockwise, Check } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'

interface Props {
  /** Called once the operator confirms the captured image. The Blob is
   *  a JPEG by default; the parent should wrap it in a File for upload. */
  onCapture: (blob: Blob) => void | Promise<void>
  /** Button label (defaults to t.dlScanner.captureFront). */
  label?: string
  className?: string
  /** Disabled state — bubbled from the parent (e.g. while a previous
   *  upload is in-flight). */
  disabled?: boolean
}

const PREFERRED_FACING_MODE: MediaTrackConstraints['facingMode'] =
  'environment'
const CAPTURE_MIME = 'image/jpeg'
const CAPTURE_QUALITY = 0.92

/**
 * Front-of-license webcam capture button + modal.
 *
 * Click → modal opens, requests camera (rear-preferred via facingMode:
 * 'environment' — works on tablets / phones; desktops fall back to the
 * default cam) → live video preview → click Capture → frame draws to
 * canvas + freezes in place → operator picks Retake or Use this photo.
 * On confirm, the JPEG blob is handed off to the parent which uploads
 * it via the same path as the file-picker button (id_scan kind).
 *
 * Stream cleanup runs on every modal close path: stream stop + video
 * srcObject = null + canvas reset. No mic — video-only constraints.
 *
 * The DlScanner reads the BACK PDF417 barcode (the data side); this
 * component captures the FRONT (the photo side). Both can target the
 * same id_scan document on the customer record.
 */
export default function WebcamCapture({
  onCapture,
  label,
  className = '',
  disabled,
}: Props) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [captured, setCaptured] = useState<Blob | null>(null)
  const [pending, setPending] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // Acquire the camera stream when the modal opens. Browser must serve
  // a secure context (localhost or https) — Vercel does. Errors surface
  // as a banner; the operator can fall back to the file upload button.
  // captured / error state is reset by close() (every exit path goes
  // through it), not here — set-state-in-effect would trip
  // react-hooks/set-state-in-effect.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    const video = videoRef.current

    async function acquire() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: PREFERRED_FACING_MODE },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop())
          return
        }
        streamRef.current = stream
        if (video) {
          video.srcObject = stream
        }
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error
              ? `${t.dlScanner.captureCameraError} (${e.name})`
              : t.dlScanner.captureCameraError,
          )
        }
      }
    }
    void acquire()

    return () => {
      cancelled = true
      const s = streamRef.current
      if (s) {
        s.getTracks().forEach((tr) => tr.stop())
        streamRef.current = null
      }
      if (video) {
        video.srcObject = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function close() {
    setOpen(false)
    setCaptured(null)
    setError(null)
    setPending(false)
  }

  function snap() {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return

    // Snap at the natural video resolution — modern back cams give us
    // 1080p+ which preserves the front-of-license number / photo
    // sharpness well past the FL retention window.
    const w = video.videoWidth
    const h = video.videoHeight
    if (w === 0 || h === 0) return

    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, w, h)

    canvas.toBlob(
      (blob) => {
        if (blob) setCaptured(blob)
      },
      CAPTURE_MIME,
      CAPTURE_QUALITY,
    )
  }

  async function confirm() {
    if (!captured) return
    setPending(true)
    try {
      await onCapture(captured)
      close()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'capture_upload_failed')
      setPending(false)
    }
  }

  function retake() {
    setCaptured(null)
  }

  const button = (
    <button
      type="button"
      onClick={() => setOpen(true)}
      disabled={disabled}
      className={
        className ||
        'inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:border-foreground disabled:opacity-50'
      }
    >
      <Camera size={14} weight="bold" />
      {label ?? t.dlScanner.captureFront}
    </button>
  )

  if (!open || typeof document === 'undefined') return button

  // Show a still <img> of the captured frame after Snap; fall back to
  // the live <video> until then. The canvas is hidden — it's only used
  // to convert the frame to a blob.
  const previewUrl = captured ? URL.createObjectURL(captured) : null

  return (
    <>
      {button}
      {createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-4"
          onClick={close}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-2xl rounded-lg border border-border bg-card p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="mb-4 flex items-center justify-between">
              <h3 className="inline-flex items-center gap-2 text-base font-semibold text-foreground">
                <Camera size={16} weight="bold" />
                {label ?? t.dlScanner.captureFront}
              </h3>
              <button
                type="button"
                onClick={close}
                className="rounded-md p-1 text-muted hover:bg-background hover:text-foreground"
                aria-label="close"
              >
                <X size={16} weight="bold" />
              </button>
            </header>

            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-md border border-border bg-navy">
              {previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewUrl}
                  alt="captured"
                  className="h-full w-full object-contain"
                  onLoad={() => URL.revokeObjectURL(previewUrl)}
                />
              ) : (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="h-full w-full object-contain"
                />
              )}
              <canvas ref={canvasRef} className="hidden" />
            </div>

            {error ? (
              <div className="mt-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
                {error}
              </div>
            ) : null}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={close}
                className="rounded-md border border-border bg-card px-4 py-2 text-sm text-foreground hover:border-foreground"
              >
                {t.dlScanner.captureCancel}
              </button>
              {captured ? (
                <>
                  <button
                    type="button"
                    onClick={retake}
                    disabled={pending}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-4 py-2 text-sm text-foreground hover:border-foreground disabled:opacity-50"
                  >
                    <ArrowsClockwise size={14} weight="bold" />
                    {t.dlScanner.captureRetake}
                  </button>
                  <button
                    type="button"
                    onClick={confirm}
                    disabled={pending}
                    className="inline-flex items-center gap-1 rounded-md bg-gold px-4 py-2 text-sm font-medium text-navy hover:bg-gold-2 disabled:opacity-50"
                  >
                    <Check size={14} weight="bold" />
                    {pending
                      ? t.dlScanner.capturing
                      : t.dlScanner.captureConfirm}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={snap}
                  disabled={!!error}
                  className="inline-flex items-center gap-1 rounded-md bg-gold px-4 py-2 text-sm font-medium text-navy hover:bg-gold-2 disabled:opacity-50"
                >
                  <Camera size={14} weight="bold" />
                  {t.dlScanner.button}
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
