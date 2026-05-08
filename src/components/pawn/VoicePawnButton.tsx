'use client'

import { useEffect, useRef, useState } from 'react'
import { Microphone, CircleNotch } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import type {
  InventoryCategory,
  MetalType,
} from '@/types/database-aliases'

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ]
  return candidates.find((c) => MediaRecorder.isTypeSupported(c))
}

function isVoiceSupported(): boolean {
  if (typeof window === 'undefined') return false
  return (
    typeof window.MediaRecorder !== 'undefined' &&
    typeof window.MediaRecorder.isTypeSupported === 'function' &&
    pickMimeType() != null
  )
}

/**
 * Shape returned by the /api/ai/voice/pawn-intake server route after
 * Whisper transcription + Claude extraction + customer match-or-create.
 *
 * `customer.isNew` is TRUE when the API created a fresh customers row
 * (so the parent form can inject it into its dropdown options before
 * selecting it). The TTS confirmation phrase also branches on this
 * — staff are asked to verify ID details for newly-created records
 * before submitting the loan.
 */
export type PawnVoiceData = {
  customer: {
    id: string
    label: string
    name: string
    isNew: boolean
  } | null
  principal: number | null
  collateral: {
    description: string
    category: InventoryCategory
    metal_type: MetalType | ''
    karat: string
    weight_grams: string
    est_value: string
  } | null
}

type ApiResponse = {
  transcript: string
  data: PawnVoiceData
}

// idle      — at-rest, gold button.
// arming    — pointer down, mic permission resolving (first press only).
// active    — recording, red pulsing button. Release to submit.
// processing — recorder stopped, waiting on Whisper + Claude.
type Phase = 'idle' | 'arming' | 'active' | 'processing'

type Props = {
  onDataExtracted: (data: PawnVoiceData) => void
}

/**
 * Speak text via the browser's Speech Synthesis API. Resolves when the
 * utterance finishes OR a fallback timer fires. Used only for the
 * post-fill confirmation; the recording flow itself is silent so the
 * push-to-talk gesture stays predictable.
 */
function speak(text: string, lang: string): Promise<void> {
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = lang
    utterance.rate = 1.0
    let done = false
    const finish = () => {
      if (done) return
      done = true
      resolve()
    }
    utterance.onend = finish
    utterance.onerror = finish
    const fallbackMs = 800 + Math.ceil(text.length * 70)
    setTimeout(finish, fallbackMs)
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
  })
}

export default function VoicePawnButton({ onDataExtracted }: Props) {
  const { t, lang } = useI18n()
  const [phase, setPhase] = useState<Phase>('idle')
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunks = useRef<Blob[]>([])
  // Set when arming starts. The pointer-up handler flips `aborted=true`
  // if the operator releases before mic permission resolves; the start
  // path checks the flag and bails out cleanly.
  const armingRef = useRef<{ aborted: boolean } | null>(null)

  const ttsLang = lang === 'es' ? 'es-MX' : 'en-US'
  const sttLang = lang === 'es' ? 'es' : 'en'

  // Cleanup any open mic stream if the component unmounts mid-session.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((tr) => tr.stop())
      streamRef.current = null
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel()
      }
    }
  }, [])

  async function handlePress(e: React.PointerEvent<HTMLButtonElement>) {
    if (phase !== 'idle') return

    if (!isVoiceSupported()) {
      setError(t.pawn.new_.voice.notSupported)
      return
    }

    setError(null)
    setTranscript('')

    // Capture the pointer so a release outside the button still fires
    // pointerup on the button. Important for mouse "drag off and let
    // go" — without capture the up event lands on whatever is under
    // the cursor and we'd never stop the recorder.
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Older browsers without setPointerCapture — pointerup fallback
      // handlers cover the common case.
    }

    const arming = { aborted: false }
    armingRef.current = arming
    setPhase('arming')

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      armingRef.current = null
      setPhase('idle')
      setError(t.pawn.new_.voice.micDenied)
      return
    }

    // User released the button before the mic permission prompt
    // resolved — abort cleanly.
    if (arming.aborted) {
      stream.getTracks().forEach((tr) => tr.stop())
      armingRef.current = null
      setPhase('idle')
      return
    }

    const mimeType = pickMimeType()
    let mr: MediaRecorder
    try {
      mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    } catch {
      stream.getTracks().forEach((tr) => tr.stop())
      armingRef.current = null
      setPhase('idle')
      setError(t.pawn.new_.voice.notSupported)
      return
    }

    streamRef.current = stream
    chunks.current = []
    mr.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.current.push(event.data)
    }
    mr.onstop = () => {
      stream.getTracks().forEach((tr) => tr.stop())
      streamRef.current = null
      const blob = new Blob(chunks.current, {
        type: mimeType ?? 'audio/webm',
      })
      void send(blob)
    }
    recorderRef.current = mr
    mr.start()
    armingRef.current = null
    setPhase('active')
  }

  function handleRelease(e: React.PointerEvent<HTMLButtonElement>) {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* not captured / already released */
    }

    // Released during the mic-permission window. Mark for abort; the
    // start path will tear down on its own.
    if (armingRef.current) {
      armingRef.current.aborted = true
      return
    }

    // Released while recording. Stop and submit.
    const mr = recorderRef.current
    if (mr && mr.state !== 'inactive') {
      mr.stop()
      recorderRef.current = null
      setPhase('processing')
    }
  }

  async function send(blob: Blob) {
    try {
      const fd = new FormData()
      fd.append('audio', blob, 'pawn-intake.webm')
      fd.append('language', sttLang)

      const res = await fetch('/api/ai/voice/pawn-intake', {
        method: 'POST',
        body: fd,
      })
      const json = (await res.json().catch(() => null)) as
        | (ApiResponse & { error?: string })
        | null
      if (!res.ok || !json) {
        throw new Error(json?.error ?? t.pawn.new_.voice.serverError)
      }
      setTranscript(json.transcript)
      onDataExtracted(json.data)

      const customer = json.data.customer
      const confirmation =
        customer == null
          ? t.pawn.new_.voice.confirmEmpty
          : customer.isNew
            ? t.pawn.new_.voice.confirmCreated.replace('{name}', customer.name)
            : t.pawn.new_.voice.confirmExisting.replace(
                '{name}',
                customer.name,
              )
      await speak(confirmation, ttsLang)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t.pawn.new_.voice.serverError,
      )
    } finally {
      setPhase('idle')
    }
  }

  const isHeld = phase === 'arming' || phase === 'active'
  const isProcessing = phase === 'processing'

  const label = isProcessing
    ? t.pawn.new_.voice.transcribing
    : phase === 'active'
      ? t.pawn.new_.voice.listening
      : t.pawn.new_.voice.start

  const buttonClass = isProcessing
    ? 'inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-muted opacity-70'
    : isHeld
      ? 'inline-flex items-center gap-2 rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white transition-colors select-none touch-none motion-safe:animate-pulse'
      : 'inline-flex items-center gap-2 rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-navy transition-all select-none touch-none hover:-translate-y-0.5 hover:bg-gold-2 hover:shadow-lg'

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={isProcessing}
          onPointerDown={handlePress}
          onPointerUp={handleRelease}
          onPointerCancel={handleRelease}
          // Stop double-firing on browsers that emit both pointer + click
          // for the same gesture (Edge in some versions).
          onClick={(e) => e.preventDefault()}
          // Prevent the default press-hold behaviors (text selection,
          // context menu, drag image) so the gesture stays clean.
          onContextMenu={(e) => e.preventDefault()}
          className={buttonClass}
        >
          {isProcessing ? (
            <CircleNotch size={16} weight="bold" className="animate-spin" />
          ) : (
            <Microphone size={16} weight={isHeld ? 'fill' : 'bold'} />
          )}
          {label}
        </button>
        <span className="text-xs text-muted">{t.pawn.new_.voice.hint}</span>
      </div>

      {transcript ? (
        <p className="text-xs text-muted">
          <span className="font-semibold text-foreground">
            {t.pawn.new_.voice.heard}:
          </span>{' '}
          {transcript}
        </p>
      ) : null}
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  )
}
