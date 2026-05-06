// src/app/(public)/unsubscribe/content.tsx
'use client'

import { CheckCircle, EnvelopeSimple } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { unsubscribeAction } from './actions'

type UnsubscribeState =
  | { kind: 'confirm'; firstName: string; token: string }
  | { kind: 'success' }
  | { kind: 'already'; firstName: string }
  | { kind: 'invalid' }

type Copy = {
  title: string
  confirmHeading: (name: string) => string
  confirmBody: string
  confirmButton: string
  successTitle: string
  successBody: string
  alreadyTitle: string
  alreadyBody: (name: string) => string
  invalidTitle: string
  invalidBody: string
}

const COPY: { en: Copy; es: Copy } = {
  en: {
    title: 'Email preferences',
    confirmHeading: (name: string) =>
      name ? `Hi ${name} — unsubscribe from marketing emails?` : 'Unsubscribe from marketing emails?',
    confirmBody:
      'You will stop receiving marketing emails from this shop. Transactional messages (loan reminders, repair pickup notices, payment receipts) will continue.',
    confirmButton: 'Unsubscribe',
    successTitle: 'You are unsubscribed',
    successBody:
      'You will no longer receive marketing emails from this shop. Transactional messages (loan reminders, repair pickup notices) will still be sent.',
    alreadyTitle: 'Already unsubscribed',
    alreadyBody: (name: string) =>
      `${name ? `Hi ${name} — ` : ''}you are already unsubscribed from marketing emails. No further action needed.`,
    invalidTitle: 'Link invalid or expired',
    invalidBody:
      'This unsubscribe link is no longer valid. If you keep receiving emails you would like to stop, please reply to a recent message and ask the shop to remove you.',
  },
  es: {
    title: 'Preferencias de correo',
    confirmHeading: (name: string) =>
      name ? `Hola ${name} — ¿darte de baja de correos de marketing?` : '¿Darte de baja de correos de marketing?',
    confirmBody:
      'Dejarás de recibir correos de marketing de esta tienda. Los mensajes transaccionales (avisos de empeño, recogidas de reparación, recibos) seguirán llegando.',
    confirmButton: 'Darme de baja',
    successTitle: 'Te has dado de baja',
    successBody:
      'Ya no recibirás correos de marketing de esta tienda. Los mensajes transaccionales (avisos de empeño, recogidas de reparación) seguirán enviándose.',
    alreadyTitle: 'Ya estás dado de baja',
    alreadyBody: (name: string) =>
      `${name ? `Hola ${name} — ` : ''}ya te diste de baja de los correos de marketing. No hace falta hacer nada más.`,
    invalidTitle: 'Enlace inválido o expirado',
    invalidBody:
      'Este enlace para darte de baja ya no es válido. Si sigues recibiendo correos que quieres parar, responde a un mensaje reciente y pide a la tienda que te elimine.',
  },
}

export default function UnsubscribeContent({
  state,
}: {
  state: UnsubscribeState
}) {
  const { lang } = useI18n()
  const copy = COPY[lang === 'es' ? 'es' : 'en']

  return (
    <main className="mx-auto w-full max-w-[480px] px-4 py-16">
      <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
        {state.kind === 'confirm' ? (
          <ConfirmView state={state} copy={copy} />
        ) : state.kind === 'success' ? (
          <SuccessView copy={copy} />
        ) : state.kind === 'already' ? (
          <AlreadyView state={state} copy={copy} />
        ) : (
          <InvalidView copy={copy} />
        )}
      </div>
    </main>
  )
}

function ConfirmView({
  state,
  copy,
}: {
  state: Extract<UnsubscribeState, { kind: 'confirm' }>
  copy: Copy
}) {
  return (
    <>
      <header className="flex items-center gap-3 border-b border-border pb-4">
        <EnvelopeSimple size={24} className="text-gold" weight="duotone" />
        <h1 className="text-lg font-semibold tracking-[-0.01em] text-foreground">
          {copy.title}
        </h1>
      </header>
      <h2 className="mt-6 text-base font-semibold text-foreground">
        {copy.confirmHeading(state.firstName)}
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        {copy.confirmBody}
      </p>
      <form action={unsubscribeAction} className="mt-6">
        <input type="hidden" name="token" value={state.token} />
        <button
          type="submit"
          className="w-full rounded-lg bg-gold px-4 py-2.5 text-sm font-semibold text-navy hover:bg-gold/90"
        >
          {copy.confirmButton}
        </button>
      </form>
    </>
  )
}

function SuccessView({ copy }: { copy: (typeof COPY)['en'] }) {
  return (
    <>
      <header className="flex items-center gap-3 border-b border-border pb-4">
        <CheckCircle size={24} className="text-success" weight="fill" />
        <h1 className="text-lg font-semibold tracking-[-0.01em] text-foreground">
          {copy.successTitle}
        </h1>
      </header>
      <p className="mt-6 text-sm leading-relaxed text-muted">
        {copy.successBody}
      </p>
    </>
  )
}

function AlreadyView({
  state,
  copy,
}: {
  state: Extract<UnsubscribeState, { kind: 'already' }>
  copy: Copy
}) {
  return (
    <>
      <header className="flex items-center gap-3 border-b border-border pb-4">
        <CheckCircle size={24} className="text-success" weight="fill" />
        <h1 className="text-lg font-semibold tracking-[-0.01em] text-foreground">
          {copy.alreadyTitle}
        </h1>
      </header>
      <p className="mt-6 text-sm leading-relaxed text-muted">
        {copy.alreadyBody(state.firstName)}
      </p>
    </>
  )
}

function InvalidView({ copy }: { copy: (typeof COPY)['en'] }) {
  return (
    <>
      <header className="flex items-center gap-3 border-b border-border pb-4">
        <EnvelopeSimple size={24} className="text-muted" weight="duotone" />
        <h1 className="text-lg font-semibold tracking-[-0.01em] text-foreground">
          {copy.invalidTitle}
        </h1>
      </header>
      <p className="mt-6 text-sm leading-relaxed text-muted">
        {copy.invalidBody}
      </p>
    </>
  )
}
