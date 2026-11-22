/**
 * Phone numbers typed by staff. Pure.
 *
 * A phone is digits with the usual separators — spaces, dashes, dots,
 * parentheses and a leading "+" — and 7 to 15 digits in all (15 is the
 * longest international number). Letters are never part of one.
 *
 * A 10-digit number (or 11 starting with 1) is stored as "(813) 555-0100",
 * the shape every existing customer record already has, so search and
 * duplicate checks keep comparing like with like. Any other length is an
 * international number and is kept as typed.
 */

const ALLOWED = /^\+?[0-9()\-.\s]+$/

/** The stored form of a typed phone, or null when it is not a phone number. */
export function normalizePhone(raw: string): string | null {
  const typed = raw.trim().replace(/\s+/g, ' ')
  if (!ALLOWED.test(typed)) return null
  const digits = typed.replace(/\D/g, '')
  if (digits.length < 7 || digits.length > 15) return null

  const international = typed.startsWith('+') && !(digits.length === 11 && digits.startsWith('1'))
  if (international) return typed
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  if (ten.length === 10) return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`
  return typed
}
