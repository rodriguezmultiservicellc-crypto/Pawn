'use client'

import { useEffect, useState } from 'react'
import {
  DEFAULT_LANGUAGE,
  getDictionary,
  isLanguage,
  type Language,
} from './config'

const LOCAL_STORAGE_KEY = 'pawn-lang'

/**
 * Lightweight hook for auth pages — no I18nProvider needed. Reads the
 * preferred language from localStorage (where I18nProvider in the staff /
 * portal shells writes it) and writes back when the user toggles.
 *
 * Returns the dictionary object directly under `t`, plus a setter. Use
 * this in /login, /magic-link, /set-password, /forgot-password, /onboard,
 * /no-tenant — anywhere the user might not be authenticated yet.
 */
export function useLangLocal() {
  const [lang, setLangState] = useState<Language>(DEFAULT_LANGUAGE)

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const stored = window.localStorage.getItem(LOCAL_STORAGE_KEY)
      if (isLanguage(stored)) setLangState(stored)
    } catch {
      // localStorage disabled — stick with default.
    }
  }, [])

  const setLang = (next: Language) => {
    setLangState(next)
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(LOCAL_STORAGE_KEY, next)
    } catch {
      // ignore
    }
  }

  return { lang, t: getDictionary(lang), setLang }
}
