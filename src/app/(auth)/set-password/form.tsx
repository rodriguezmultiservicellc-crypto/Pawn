'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useLangLocal } from '@/lib/i18n/use-lang'

/**
 * First-time password set for invited portal users (and password reset
 * landing page after the recovery callback). Assumes the visitor already
 * has a session — typically they came in via /auth/callback or
 * /magic-link with a recovery / invite token.
 *
 * If there's no session, we redirect to /magic-link so they can request
 * a fresh sign-in link.
 */
export default function SetPasswordForm() {
  const router = useRouter()
  const params = useSearchParams()
  const next = params.get('next') ?? '/portal/loans'
  const { t, lang, setLang } = useLangLocal()

  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (pw.length < 8) {
      setError(t.auth.setPasswordPage.tooShort)
      return
    }
    if (pw !== pw2) {
      setError(t.auth.setPasswordPage.mismatch)
      return
    }
    setSubmitting(true)
    const supabase = createClient()

    // Make sure we actually have a session before attempting to update.
    const { data: sess } = await supabase.auth.getSession()
    if (!sess.session) {
      setSubmitting(false)
      router.replace(`/magic-link?next=${encodeURIComponent('/set-password')}`)
      return
    }

    const { error: uErr } = await supabase.auth.updateUser({ password: pw })
    setSubmitting(false)
    if (uErr) {
      setError(t.common.error)
      return
    }
    setDone(true)
    // Redirect after a short delay so the user sees the success message.
    window.setTimeout(() => {
      window.location.assign(next)
    }, 600)
  }

  if (done) {
    return (
      <div className="space-y-3 text-center">
        <h2 className="text-xl font-semibold text-foreground">
          {t.auth.setPasswordPage.title}
        </h2>
        <p className="text-sm text-success">{t.auth.setPasswordPage.success}</p>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h2 className="text-xl font-semibold text-foreground">
        {t.auth.setPasswordPage.title}
      </h2>
      <p className="text-sm text-muted">{t.auth.setPasswordPage.help}</p>

      {error ? (
        <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}

      <label className="block space-y-1">
        <span className="text-sm font-semibold text-text-secondary">
          {t.auth.setPasswordPage.newPassword}
        </span>
        <input
          type="password"
          required
          minLength={8}
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
          autoComplete="new-password"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-semibold text-text-secondary">
          {t.auth.setPasswordPage.confirmPassword}
        </span>
        <input
          type="password"
          required
          minLength={8}
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
          className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
          autoComplete="new-password"
        />
      </label>

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-xl bg-gold px-4 py-3.5 text-sm font-bold text-navy transition-all hover:bg-gold-2 hover:-translate-y-0.5 hover:shadow-lg disabled:opacity-50 disabled:translate-y-0 disabled:shadow-none"
      >
        {submitting
          ? t.auth.setPasswordPage.submitting
          : t.auth.setPasswordPage.submit}
      </button>

      <div className="flex items-center justify-between text-sm">
        <Link
          href="/login"
          className="text-foreground underline-offset-2 hover:underline"
        >
          {t.auth.magicLinkPage.backToLogin}
        </Link>
        <button
          type="button"
          onClick={() => setLang(lang === 'en' ? 'es' : 'en')}
          className="text-muted hover:text-foreground"
        >
          {lang === 'en' ? t.lang.es : t.lang.en}
        </button>
      </div>
    </form>
  )
}
