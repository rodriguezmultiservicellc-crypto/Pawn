'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Buildings, DownloadSimple, FileText, PencilSimple, Warning, CheckCircle } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import type { ProfileFact } from '@/lib/agency-forms/profile'
import { saveFormAnswersAction } from './actions'

export type FormCard = {
  id: string
  agency: string
  code: string
  questions: Array<{ key: string; options: string[] }>
  answers: Record<string, string>
  missing: ProfileFact[]
}

type FormWords = {
  title: string
  description: string
  editionNote: string
  questions: Record<string, { label: string; options: Record<string, string> }>
}

export default function GovernmentFormsContent({
  forms,
  profileSaved,
  legalName,
}: {
  forms: FormCard[]
  profileSaved: boolean
  legalName: string | null
}) {
  const { t } = useI18n()
  const a = t.agencyForms

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold text-foreground">{a.title}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">{a.subtitle}</p>
      </header>

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
        <div className="flex items-start gap-3">
          <span className="rounded-lg bg-gold/10 p-2 text-gold">
            <Buildings size={20} weight="regular" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-foreground">{a.profileTitle}</h2>
            <p className="text-sm text-foreground">{legalName ?? '—'}</p>
            <p className="text-xs text-muted">{profileSaved ? a.profileSubtitle : a.profileNotSaved}</p>
          </div>
        </div>
        <Link
          href="/government-forms/profile"
          className="inline-flex items-center gap-1 rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:border-gold"
        >
          <PencilSimple size={14} weight="bold" />
          {a.editProfile}
        </Link>
      </section>

      {forms.map((f) => (
        <FormItem key={f.id} form={f} words={(a.forms as Record<string, FormWords>)[f.id]} />
      ))}
    </div>
  )
}

function FormItem({ form, words }: { form: FormCard; words: FormWords | undefined }) {
  const { t } = useI18n()
  const a = t.agencyForms
  const [answers, setAnswers] = useState(form.answers)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const ready = form.missing.length === 0

  function download() {
    setError(null)
    startTransition(async () => {
      // Keep the choices for next time, then hand the browser the PDF.
      const r = await saveFormAnswersAction(form.id, answers)
      if (!r.ok) {
        setError((a.errors as Record<string, string>)[r.error] ?? r.error)
        return
      }
      window.location.href = `/api/agency-forms/${form.id}`
    })
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <span className="rounded-lg bg-blue/10 p-2 text-blue">
          <FileText size={20} weight="regular" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            {form.agency} · {form.code}
          </p>
          <h2 className="text-base font-semibold text-foreground">{words?.title ?? form.code}</h2>
          {words ? <p className="text-sm text-muted">{words.description}</p> : null}
          {words ? <p className="mt-1 text-xs text-muted">{words.editionNote}</p> : null}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        {form.questions.map((q) => {
          const qw = words?.questions[q.key]
          return (
            <fieldset key={q.key} className="space-y-1.5">
              <legend className="text-xs font-semibold text-foreground">{qw?.label ?? q.key}</legend>
              {q.options.map((opt) => (
                <label key={opt} className="flex items-start gap-2 text-sm text-foreground">
                  <input
                    type="radio"
                    name={`${form.id}-${q.key}`}
                    checked={answers[q.key] === opt}
                    onChange={() => setAnswers((prev) => ({ ...prev, [q.key]: opt }))}
                    className="mt-1 accent-gold"
                  />
                  <span>{qw?.options[opt] ?? opt}</span>
                </label>
              ))}
            </fieldset>
          )
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        {ready ? (
          <span className="inline-flex items-center gap-1 text-sm text-success">
            <CheckCircle size={16} weight="fill" />
            {a.ready}
          </span>
        ) : (
          <span className="inline-flex items-start gap-1 text-sm text-danger">
            <Warning size={16} weight="fill" className="mt-0.5 shrink-0" />
            <span>
              {a.missing.replace('{facts}', form.missing.map((m) => a.facts[m]).join(', '))}{' '}
              <Link href="/government-forms/profile" className="font-semibold underline-offset-2 hover:underline">
                {a.editProfile}
              </Link>
            </span>
          </span>
        )}
        <div className="flex items-center gap-2">
          {error ? <span className="text-xs text-danger">{error}</span> : null}
          <button
            type="button"
            onClick={download}
            disabled={!ready || pending}
            className="inline-flex items-center gap-1 rounded-xl bg-gold px-4 py-2 text-sm font-bold text-navy transition-all hover:-translate-y-0.5 hover:bg-gold-2 hover:shadow-lg disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none"
          >
            <DownloadSimple size={16} weight="bold" />
            {pending ? a.preparing : a.download}
          </button>
        </div>
      </div>
    </section>
  )
}
