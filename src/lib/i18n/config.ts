import { en, type Dictionary } from './en'
import { es } from './es'

export type Language = 'en' | 'es'

export const LANGUAGES: ReadonlyArray<Language> = ['en', 'es']

export const DEFAULT_LANGUAGE: Language = 'en'

export function isLanguage(value: unknown): value is Language {
  return value === 'en' || value === 'es'
}

export function getDictionary(lang: Language): Dictionary {
  return lang === 'es' ? es : en
}

export type { Dictionary }
