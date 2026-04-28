'use client'

import { useActionState, useState } from 'react'
import { EnvelopeSimple, Translate } from '@phosphor-icons/react'
import { useLangLocal } from '@/lib/i18n/use-lang'
import {
  requestPortalLoginAction,
  type PortalLoginState,
} from './actions'

export default function PortalLoginForm() {
  const { t, lang, setLang } = useLangLocal()
  const [state, formAction, pending] = useActionState<
    PortalLoginState,
    FormData
  >(requestPortalLoginAction, {})
  const [email, setEmail] = useState('')

  if (state.ok) {
    return (
      <div className="space-y-4 text-center">
        <h2 className="text-xl font-semibold text-ink">
          {t.portal.login.checkEmailTitle}
        </h2>
        <p className="text-sm text-ash">{t.portal.login.checkEmailBody}</p>
        <p className="text-xs text-ash">
          {t.portal.login.checkSpamHint}
        </p>
        <div className="flex items-center justify-center">
          <button
            type="button"
            onClick={() => setLang(lang === 'en' ? 'es' : 'en')}
            className="inline-flex items-center gap-1 text-xs text-ash hover:text-ink"
          >
            <Translate size={12} weight="regular" />
            <span>{lang === 'en' ? t.lang.es : t.lang.en}</span>
          </button>
        </div>
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1 text-center">
        <h2 className="text-xl font-semibold text-ink">
          {t.portal.login.title}
        </h2>
        <p className="text-sm text-ash">{t.portal.login.help}</p>
      </div>

      {state.error ? (
        <div className="rounded-md border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">
          {translateError(state.error, t)}
        </div>
      ) : null}

      <label className="block space-y-1">
        <span className="text-sm font-medium text-ink">{t.auth.email}</span>
        <input
          type="email"
          name="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
          autoComplete="email"
          inputMode="email"
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-rausch px-4 py-2.5 font-medium text-canvas hover:bg-rausch-deep disabled:opacity-50"
      >
        <EnvelopeSimple size={16} weight="bold" />
        {pending ? t.common.saving : t.portal.login.sendLink}
      </button>

      <div className="flex items-center justify-between text-xs">
        <span className="text-ash">{t.portal.login.notACustomer}</span>
        <button
          type="button"
          onClick={() => setLang(lang === 'en' ? 'es' : 'en')}
          className="inline-flex items-center gap-1 text-ash hover:text-ink"
        >
          <Translate size={12} weight="regular" />
          <span>{lang === 'en' ? t.lang.es : t.lang.en}</span>
        </button>
      </div>
    </form>
  )
}

function translateError(
  reason: string,
  t: ReturnType<typeof useLangLocal>['t'],
): string {
  const map: Record<string, string> = {
    invalid_email: t.portal.login.errInvalidEmail,
    app_url_not_configured: t.portal.login.errAppUrlMissing,
  }
  return map[reason] ?? t.common.error
}
