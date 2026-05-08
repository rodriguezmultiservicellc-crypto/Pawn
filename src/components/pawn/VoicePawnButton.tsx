'use client'

import { useEffect, useRef, useState } from 'react'
import { Microphone, Stop, CircleNotch } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import type {
  InventoryCategory,
  MetalType,
} from '@/types/database-aliases'

function isVoiceSupported(): boolean {
  if (typeof window === 'undefined') return false
  return (
    typeof window.speechSynthesis !== 'undefined' &&
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

type Phase = 'idle' | 'active' | 'processing'

type Props = {
  onDataExtracted: (data: PawnVoiceData) => void
}

/**
 * Speak text via the browser's Speech Synthesis API. Resolves when the
 * utterance finishes OR a fallback timer fires (Safari occasionally
 * drops `onend` after a getUserMedia call earlier in the same gesture).
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
    // Fallback: estimate at ~14 chars/sec + 800ms padding so a dropped
    // onend can't hang the recording flow.
    const fallbackMs = 800 + Math.ceil(text.length * 70)
    setTimeout(finish, fallbackMs)
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
  })
}

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

export default function VoicePawnButton({ onDataExtracted }: Props) {
  const { t, lang } = useI18n()
  const [phase, setPhase] = useState<Phase>('idle')
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunks = useRef<Blob[]>([])
  // True between Start press and either: greeting still playing OR
  // recorder hasn't started yet. Pressing Stop in this window cancels
  // without sending audio.
  const armedRef = useRef(false)

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

  async function start() {
    setError(null)
    setTranscript('')

    // Feature-detect at click time. Done here (instead of useEffect on
    // mount) so server/client first paint match — the button always
    // renders, and unsupported browsers see the notSupported message
    // only after they actually try to use it.
    if (!isVoiceSupported()) {
      setError(t.pawn.new_.voice.notSupported)
      return
    }

    armedRef.current = true
    setPhase('active')

    // Request mic FIRST (triggers permission prompt) so the greeting
    // plays without interruption AND the same MediaStream is reused
    // for recording — avoids a second prompt.
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      armedRef.current = false
      setPhase('idle')
      setError(t.pawn.new_.voice.micDenied)
      return
    }
    streamRef.current = stream

    await speak(t.pawn.new_.voice.greeting, ttsLang)

    // Operator may have pressed Stop during the greeting. Bail out
    // cleanly without firing up the recorder.
    if (!armedRef.current) {
      stream.getTracks().forEach((tr) => tr.stop())
      streamRef.current = null
      setPhase('idle')
      return
    }

    const mimeType = pickMimeType()
    let mr: MediaRecorder
    try {
      mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    } catch {
      stream.getTracks().forEach((tr) => tr.stop())
      streamRef.current = null
      armedRef.current = false
      setPhase('idle')
      setError(t.pawn.new_.voice.notSupported)
      return
    }

    chunks.current = []
    mr.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.current.push(e.data)
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
  }

  function stop() {
    armedRef.current = false
    const mr = recorderRef.current
    if (!mr) {
      // Greeting was still playing — we already armedRef-cancel above.
      // Tear down the stream and reset.
      streamRef.current?.getTracks().forEach((tr) => tr.stop())
      streamRef.current = null
      setPhase('idle')
      return
    }
    if (mr.state !== 'inactive') mr.stop()
    recorderRef.current = null
    setPhase('processing')
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
    } catch (e) {
      setError(
        e instanceof Error ? e.message : t.pawn.new_.voice.serverError,
      )
    } finally {
      setPhase('idle')
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        {phase === 'idle' ? (
          <button
            type="button"
            onClick={start}
            className="inline-flex items-center gap-2 rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-navy transition-all hover:-translate-y-0.5 hover:bg-gold-2 hover:shadow-lg"
          >
            <Microphone size={16} weight="bold" />
            {t.pawn.new_.voice.start}
          </button>
        ) : phase === 'active' ? (
          <button
            type="button"
            onClick={stop}
            className="inline-flex items-center gap-2 rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-danger/90 motion-safe:animate-pulse"
          >
            <Stop size={16} weight="fill" />
            {t.pawn.new_.voice.stop}
          </button>
        ) : (
          <button
            type="button"
            disabled
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-muted opacity-70"
          >
            <CircleNotch size={16} weight="bold" className="animate-spin" />
            {t.pawn.new_.voice.transcribing}
          </button>
        )}
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
