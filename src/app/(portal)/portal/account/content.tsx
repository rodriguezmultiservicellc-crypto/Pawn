'use client'

import { useState } from 'react'
import { CheckCircle, Key, Warning } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { createClient } from '@/lib/supabase/client'

/**
 * Account settings — set/change password. The "did the user already
 * have a password?" distinction doesn't matter to Supabase: both paths
 * call updateUser({ password }), and Supabase issues no current-
 * password challenge by default. The form copy ("Set or change") covers
 * both cases.
 *
 * After a successful update we leave the customer on the same page
 * with a green confirmation rather than redirecting — gives them a
 * moment to register the change.
 */
export default function AccountContent({
  email,
  customerName,
}: {
  email: string | null
  customerName: string | null
}) {
  const { t } = useI18n()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setDone(false)

    const trimmed = password
    if (trimmed.length < 8) {
      setError(t.portal.account.errTooShort)
      return
    }
    if (trimmed !== confirm) {
      setError(t.portal.account.errMismatch)
      return
    }

    setBusy(true)
    try {
      const supabase = createClient()
      const { error: upErr } = await supabase.auth.updateUser({
        password: trimmed,
      })
      if (upErr) {
        setError(upErr.message)
      } else {
        setDone(true)
        setPassword('')
        setConfirm('')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">
          {t.portal.account.title}
        </h1>
        <p className="mt-1 text-sm text-ash">{t.portal.account.subtitle}</p>
      </div>

      {/* Identity card — read-only. */}
      <fieldset className="rounded-lg border border-hairline bg-canvas p-4">
        <legend className="px-1 text-sm font-semibold text-ink">
          {t.portal.account.identity}
        </legend>
        <dl className="mt-2 grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
          <dt className="text-ash">{t.portal.account.name}</dt>
          <dd className="col-span-2 text-ink">
            {customerName || (
              <span className="italic text-ash">
                {t.portal.account.noNameOnFile}
              </span>
            )}
          </dd>
          <dt className="text-ash">{t.portal.account.email}</dt>
          <dd className="col-span-2 break-all font-mono text-xs text-ink">
            {email}
          </dd>
        </dl>
        <p className="mt-2 text-xs text-ash">
          {t.portal.account.emailReadOnlyHelp}
        </p>
      </fieldset>

      {/* Password card. */}
      <fieldset className="rounded-lg border border-hairline bg-canvas p-4">
        <legend className="flex items-center gap-1 px-1 text-sm font-semibold text-ink">
          <Key size={14} weight="bold" />
          <span>{t.portal.account.passwordTitle}</span>
        </legend>
        <p className="mt-1 text-xs text-ash">
          {t.portal.account.passwordHelp}
        </p>

        {error ? (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">
            <Warning size={14} weight="bold" />
            <span>{error}</span>
          </div>
        ) : null}

        {done ? (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm text-success">
            <CheckCircle size={14} weight="bold" />
            <span>{t.portal.account.savedConfirmation}</span>
          </div>
        ) : null}

        <form onSubmit={onSubmit} className="mt-3 space-y-3">
          <label className="block space-y-1">
            <span className="text-sm font-medium text-ink">
              {t.portal.account.newPassword}
            </span>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-sm font-medium text-ink">
              {t.portal.account.confirmPassword}
            </span>
            <input
              type="password"
              required
              minLength={8}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
            />
          </label>

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-rausch px-4 py-2.5 font-medium text-canvas hover:bg-rausch-deep disabled:opacity-50 sm:w-auto"
          >
            {busy ? t.common.saving : t.portal.account.savePassword}
          </button>
        </form>
      </fieldset>
    </div>
  )
}
