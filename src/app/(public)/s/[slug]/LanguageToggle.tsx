'use client'

import { useI18n } from '@/lib/i18n/context'
import { LANGUAGES, type Language } from '@/lib/i18n/config'

/**
 * Pill-style EN | ES toggle for the public landing header. Compact —
 * the public surface is mobile-first and a wider segmented control
 * eats too much header height. Uses the same I18nProvider context the
 * staff and portal layouts use, but the (public) layout passes
 * persistRemote=false so the toggle only writes to localStorage.
 */
export default function LanguageToggle() {
  const { lang, setLang } = useI18n()
  return (
    <div
      role="group"
      aria-label="Language"
      className="inline-flex items-center rounded-pill border border-hairline bg-canvas p-0.5"
    >
      {LANGUAGES.map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => setLang(code)}
          aria-pressed={lang === code}
          className={`rounded-pill px-3 py-1 text-xs font-semibold uppercase tracking-wide transition ${
            lang === code
              ? 'bg-ink text-canvas'
              : 'text-ash hover:text-ink'
          }`}
        >
          {labelFor(code)}
        </button>
      ))}
    </div>
  )
}

function labelFor(lang: Language): string {
  return lang === 'en' ? 'EN' : 'ES'
}
