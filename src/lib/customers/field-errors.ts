import type { Dictionary } from '@/lib/i18n/en'

/**
 * A customer-form field error code (from customerCreateSchema) in the user's
 * language. Codes it does not know are returned unchanged, so older raw
 * messages keep showing rather than disappearing.
 */
export function customerFieldErrorText(t: Dictionary, code: string | undefined): string | undefined {
  if (!code) return undefined
  const known = t.customers.fieldErrors as Record<string, string>
  return known[code] ?? code
}
