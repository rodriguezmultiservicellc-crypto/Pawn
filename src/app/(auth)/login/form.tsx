'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useLangLocal } from '@/lib/i18n/use-lang'

export default function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const next = params.get('next') ?? '/'
  const errorParam = params.get('error')
  const { t, lang, setLang } = useLangLocal()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(
    errorParam === 'invite_expired'
      ? t.auth.inviteExpired
      : errorParam === 'session_expired'
      ? t.auth.sessionExpired
      : null,
  )

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const supabase = createClient()
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    setSubmitting(false)
    if (authError) {
      setError(t.auth.invalidCredentials)
      return
    }
    router.push(next)
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h2 className="text-xl font-semibold text-foreground">{t.auth.signIn}</h2>

      {error ? (
        <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}

      <label className="block space-y-1">
        <span className="text-sm font-semibold text-text-secondary">{t.auth.email}</span>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
          autoComplete="email"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-semibold text-text-secondary">{t.auth.password}</span>
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
          autoComplete="current-password"
        />
      </label>

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-xl bg-gold px-4 py-3.5 text-sm font-bold text-navy transition-all hover:bg-gold-2 hover:-translate-y-0.5 hover:shadow-lg disabled:opacity-50 disabled:translate-y-0 disabled:shadow-none"
      >
        {submitting ? t.common.loading : t.auth.signIn}
      </button>

      <div className="flex items-center justify-between text-sm">
        <Link
          href="/forgot-password"
          className="text-blue transition-colors hover:text-blue-2"
        >
          {t.auth.forgotPassword}
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
