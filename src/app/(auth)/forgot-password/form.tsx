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
        <h2 className="text-xl font-semibold text-ink">
          {t.auth.forgotPassword}
        </h2>
        <p className="text-sm text-ash">{t.auth.passwordResetSent}</p>
        <Link
          href="/login"
          className="inline-block rounded-md border border-hairline px-4 py-2 text-sm text-ink"
        >
          {t.common.back}
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h2 className="text-xl font-semibold text-ink">
        {t.auth.forgotPassword}
      </h2>
      <label className="block space-y-1">
        <span className="text-sm font-medium text-ink">{t.auth.email}</span>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
          autoComplete="email"
        />
      </label>
      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-md bg-rausch px-4 py-2.5 text-canvas font-medium hover:bg-rausch-deep disabled:opacity-50"
      >
        {submitting ? t.common.loading : t.common.confirm}
      </button>
      <Link
        href="/login"
        className="block text-center text-sm text-ash hover:text-ink"
      >
        {t.common.back}
      </Link>
    </form>
  )
}
