'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useLangLocal } from '@/lib/i18n/use-lang'

export default function ForgotPasswordForm() {
  const { t } = useLangLocal()
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    const supabase = createClient()
    // Generic success message regardless of result — no email-existence leak.
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo:
        typeof window !== 'undefined'
          ? `${window.location.origin}/auth/callback?next=/set-password`
          : undefined,
    })
    setSubmitting(false)
    setSent(true)
  }

  if (sent) {
    return (
      <div className="space-y-4 text-center">
        <h2 className="text-xl font-semibold text-foreground">
          {t.auth.forgotPassword}
        </h2>
        <p className="text-sm text-muted">{t.auth.passwordResetSent}</p>
        <Link
          href="/login"
          className="inline-block rounded-md border border-border px-4 py-2 text-sm text-foreground"
        >
          {t.common.back}
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h2 className="text-xl font-semibold text-foreground">
        {t.auth.forgotPassword}
      </h2>
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
      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-xl bg-gold px-4 py-3.5 text-sm font-bold text-navy transition-all hover:bg-gold-2 hover:-translate-y-0.5 hover:shadow-lg disabled:opacity-50 disabled:translate-y-0 disabled:shadow-none"
      >
        {submitting ? t.common.loading : t.common.confirm}
      </button>
      <Link
        href="/login"
        className="block text-center text-sm text-muted hover:text-foreground"
      >
        {t.common.back}
      </Link>
    </form>
  )
}
