'use client'

import { useActionState, useState } from 'react'
import { EnvelopeSimple, Translate, Warning } from '@phosphor-icons/react'
import { useLangLocal } from '@/lib/i18n/use-lang'
import { createClient } from '@/lib/supabase/client'
import {
  requestPortalLoginAction,
  type PortalLoginState,
} from './actions'

/**
 * Customer portal sign-in. Smart "Sign in" button:
 *   - email + password → supabase.auth.signInWithPassword (instant).
 *     On success, hard-nav to /api/portal/sign-in-bridge so the
 *     active-tenant cookie gets set before the (portal) layout runs.
 *   - email only       → server action requestPortalLoginAction →
 *     mints magic-link via per-tenant Resend.
 *
 * Customers who never set a password just leave the password field
 * blank and use the magic link. The "I forgot my password" path is
 * the same: leave it blank, get the magic link.
 */
export default function PortalLoginForm() {
  const { t, lang, setLang } = useLangLocal()
  const [magicState, magicAction, magicPending] = useActionState<
    PortalLoginState,
    FormData
  >(requestPortalLoginAction, {})
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [pwError, setPwError] = useState<string | null>(null)
  const [showPw, setShowPw] = useState(false)

  // After magic-link success, swap the form for a confirmation card.
  if (magicState.ok) {
    return (
      <div className="space-y-4 text-center">
        <h2 className="text-xl font-semibold text-foreground">
          {t.portal.login.checkEmailTitle}
        </h2>
        <p className="text-sm text-muted">{t.portal.login.checkEmailBody}</p>
        <p className="text-xs text-muted">{t.portal.login.checkSpamHint}</p>
        <div className="flex items-center justify-center">
          <button
            type="button"
            onClick={() => setLang(lang === 'en' ? 'es' : 'en')}
            className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground"
          >
            <Translate size={12} weight="regular" />
            <span>{lang === 'en' ? t.lang.es : t.lang.en}</span>
          </button>
        </div>
      </div>
    )
  }

  // Submit handler — branches on whether password is filled.
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPwError(null)
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setPwError(t.portal.login.errInvalidEmail)
      return
    }

    if (password) {
      // Password sign-in path — purely client-side until the bridge.
      setPwBusy(true)
      try {
        const supabase = createClient()
        const { error: signInErr } = await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        })
        if (signInErr) {
          setPwError(t.portal.login.errBadCredentials)
          return
        }
        // Hard-nav so the proxy + layout see the fresh session cookie.
        window.location.assign('/api/portal/sign-in-bridge')
      } finally {
        setPwBusy(false)
      }
      return
    }

    // No password → magic-link path. Fall through to the form action.
    const fd = new FormData()
    fd.set('email', email.trim().toLowerCase())
    magicAction(fd)
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1 text-center">
        <h2 className="text-xl font-semibold text-foreground">
          {t.portal.login.title}
        </h2>
        <p className="text-sm text-muted">{t.portal.login.help}</p>
      </div>

      {pwError ? (
        <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          <Warning size={14} weight="bold" />
          <span>{pwError}</span>
        </div>
      ) : null}

      {magicState.error ? (
        <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {translateMagicError(magicState.error, t)}
        </div>
      ) : null}

      <label className="block space-y-1">
        <span className="text-sm font-semibold text-text-secondary">{t.auth.email}</span>
        <input
          type="email"
          name="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
          autoComplete="email"
          inputMode="email"
        />
      </label>

      <label className="block space-y-1">
        <span className="flex items-center justify-between text-sm font-semibold text-text-secondary">
          <span>
            {t.portal.login.passwordLabel}{' '}
            <span className="text-xs font-normal text-muted">
              ({t.common.optional})
            </span>
          </span>
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            className="text-xs font-normal text-muted hover:text-foreground"
          >
            {showPw ? t.portal.login.hide : t.portal.login.show}
          </button>
        </span>
        <input
          type={showPw ? 'text' : 'password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="block w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-blue"
          autoComplete="current-password"
        />
      </label>

      <button
        type="submit"
        disabled={pwBusy || magicPending}
        className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-gold px-4 py-2.5 font-medium text-navy hover:bg-gold-2 disabled:opacity-50"
      >
        {password ? null : <EnvelopeSimple size={16} weight="bold" />}
        <span>
          {pwBusy
            ? t.common.saving
            : magicPending
              ? t.common.saving
              : password
                ? t.portal.login.signIn
                : t.portal.login.sendLink}
        </span>
      </button>

      <p className="text-center text-xs text-muted">
        {t.portal.login.noPasswordHint}
      </p>

      <div className="flex items-center justify-between text-xs">
        <span className="text-muted">{t.portal.login.notACustomer}</span>
        <button
          type="button"
          onClick={() => setLang(lang === 'en' ? 'es' : 'en')}
          className="inline-flex items-center gap-1 text-muted hover:text-foreground"
        >
          <Translate size={12} weight="regular" />
          <span>{lang === 'en' ? t.lang.es : t.lang.en}</span>
        </button>
      </div>
    </form>
  )
}

function translateMagicError(
  reason: string,
  t: ReturnType<typeof useLangLocal>['t'],
): string {
  const map: Record<string, string> = {
    invalid_email: t.portal.login.errInvalidEmail,
    app_url_not_configured: t.portal.login.errAppUrlMissing,
  }
  return map[reason] ?? t.common.error
}
