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
      className="inline-flex items-center rounded-xl border border-border bg-card p-0.5"
    >
      {LANGUAGES.map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => setLang(code)}
          aria-pressed={lang === code}
          className={`rounded-xl px-3 py-1 text-xs font-semibold uppercase tracking-wide transition ${
            lang === code
              ? 'bg-navy text-white'
              : 'text-muted hover:text-foreground'
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
