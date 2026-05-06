'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useLangLocal } from '@/lib/i18n/use-lang'

/**
 * Magic-link page. Two modes:
 *
 *   1. Token-callback mode — when the URL hits /magic-link with either
 *      - ?token_hash=...&type=magiclink/email/recovery (PKCE-style hash for
 *        Supabase email OTPs after they introduced verifyOtp).
 *      - #access_token=...&refresh_token=... (legacy implicit flow).
 *      We exchange/setSession then redirect to /portal.
 *
 *   2. Request mode — empty querystring; user enters their email and we
 *      send a magic link. Redirect target after click is /magic-link
 *      (this same page) with the token, then we forward to /portal.
 *
 * The default redirect after successful sign-in is `?next=` if present,
 * otherwise /portal/loans (clients land on their loans).
 */
export default function MagicLinkForm() {
  const router = useRouter()
  const params = useSearchParams()
  const { t, lang, setLang } = useLangLocal()

  const next = params.get('next') ?? '/portal/loans'
  const tokenHash = params.get('token_hash')
  const tokenType = params.get('type') ?? 'magiclink'

  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)
  const [verifying, setVerifying] = useState(
    Boolean(
      tokenHash ||
        (typeof window !== 'undefined' && window.location.hash.length > 1),
    ),
  )
  const [error, setError] = useState<string | null>(null)

  // Token-callback mode.
  useEffect(() => {
    if (!verifying) return
    const supabase = createClient()

    async function run() {
      // PKCE / OTP path: token_hash + type query params.
      if (tokenHash) {
        const allowedTypes = ['magiclink', 'email', 'recovery', 'invite']
        const safeType = allowedTypes.includes(tokenType)
          ? (tokenType as 'magiclink' | 'email' | 'recovery' | 'invite')
          : 'magiclink'
        const { error: vErr } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: safeType,
        })
        if (vErr) {
          setError(t.auth.magicLinkPage.invalid)
          setVerifying(false)
          return
        }
        // Use a hard nav so the proxy sees the fresh session cookie.
        window.location.assign(next)
        return
      }

      // Implicit flow: hash fragment carries access_token + refresh_token.
      if (typeof window !== 'undefined' && window.location.hash.length > 1) {
        const hash = new URLSearchParams(window.location.hash.slice(1))
        const accessToken = hash.get('access_token')
        const refreshToken = hash.get('refresh_token')
        if (accessToken && refreshToken) {
          const { error: sErr } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          })
          if (sErr) {
            setError(t.auth.magicLinkPage.invalid)
            setVerifying(false)
            return
          }
          window.location.assign(next)
          return
        }
      }

      // Neither — bad link.
      setError(t.auth.magicLinkPage.invalid)
      setVerifying(false)
    }

    void run()
    // We intentionally only depend on verifying / tokenHash so the verify
    // step runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verifying, tokenHash])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const supabase = createClient()
    const { error: authError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo:
          typeof window !== 'undefined'
            ? `${window.location.origin}/magic-link?next=${encodeURIComponent(next)}`
            : undefined,
        shouldCreateUser: false,
      },
    })
    setSubmitting(false)
    if (authError) {
      setError(t.common.error)
      return
    }
    setSent(true)
  }

  if (verifying) {
    return (
      <div className="space-y-3 text-center">
        <h2 className="text-xl font-semibold text-foreground">
          {t.auth.magicLinkPage.title}
        </h2>
        <p className="text-sm text-muted">{t.auth.magicLinkPage.verifying}</p>
        {error ? (
          <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
            {error}
          </div>
        ) : null}
      </div>
    )
  }

  if (sent) {
    return (
      <div className="space-y-4 text-center">
        <h2 className="text-xl font-semibold text-foreground">
          {t.auth.magicLinkPage.title}
        </h2>
        <p className="text-sm text-muted">{t.auth.magicLinkSent}</p>
        <button
          type="button"
          onClick={() => {
            setSent(false)
            setSubmitting(false)
            setEmail('')
          }}
          className="text-sm text-muted hover:text-foreground"
        >
          {t.portal.common.tryAgain}
        </button>
        <Link
          href="/login"
          className="block text-sm text-muted hover:text-foreground"
          onClick={() => {
            router.refresh()
          }}
        >
          {t.auth.magicLinkPage.backToLogin}
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h2 className="text-xl font-semibold text-foreground">
        {t.auth.magicLinkPage.title}
      </h2>
      <p className="text-sm text-muted">{t.auth.magicLinkPage.help}</p>

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

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-xl bg-gold px-4 py-3.5 text-sm font-bold text-navy transition-all hover:bg-gold-2 hover:-translate-y-0.5 hover:shadow-lg disabled:opacity-50 disabled:translate-y-0 disabled:shadow-none"
      >
        {submitting ? t.auth.magicLinkPage.sending : t.auth.sendMagicLink}
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
