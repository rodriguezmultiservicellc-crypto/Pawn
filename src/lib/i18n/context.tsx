'use client'

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  DEFAULT_LANGUAGE,
  getDictionary,
  isLanguage,
  type Dictionary,
  type Language,
} from './config'

type I18nContextValue = {
  lang: Language
  t: Dictionary
  setLang: (lang: Language) => void
}

const I18nContext = createContext<I18nContextValue | null>(null)

const LOCAL_STORAGE_KEY = 'pawn-lang'

type Props = {
  initialLang?: Language
  /**
   * Persist language changes to the user's profile via
   * /api/profile/language. Defaults to TRUE for staff / portal layouts
   * where there's an authenticated user. Set FALSE for unauthenticated
   * surfaces like the public landing page — the fetch would 401 silently
   * and the localStorage write is enough.
   */
  persistRemote?: boolean
  children: ReactNode
}

/**
 * I18n provider for staff and portal layouts. Reads the initial language
 * from a server-side prop (driven by profiles.language) and falls back to
 * localStorage. Persists changes to both localStorage and the server via
 * /api/profile/language (skipped when persistRemote=false).
 */
export function I18nProvider({
  initialLang,
  persistRemote = true,
  children,
}: Props) {
  const [lang, setLangState] = useState<Language>(
    () => initialLang ?? DEFAULT_LANGUAGE,
  )

  const setLang = useCallback(
    (next: Language) => {
      setLangState(next)
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(LOCAL_STORAGE_KEY, next)
        } catch {
          // localStorage may be disabled — fine, server still has it.
        }
        if (persistRemote) {
          // Persist to profile (fire-and-forget). The endpoint validates auth.
          void fetch('/api/profile/language', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ language: next }),
          })
        }
      }
    },
    [persistRemote],
  )

  const value = useMemo<I18nContextValue>(
    () => ({ lang, t: getDictionary(lang), setLang }),
    [lang, setLang],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext)
  if (!ctx) {
    throw new Error(
      'useI18n must be used within an I18nProvider. Wrap your route group layout in <I18nProvider initialLang={...}>.',
    )
  }
  return ctx
}

export { isLanguage, type Language, type Dictionary }
