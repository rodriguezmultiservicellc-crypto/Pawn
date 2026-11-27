/**
 * The customer page of a pawn ticket — /p/<token> (patches/0127). Pure.
 * Token: 32 lowercase hex (one UUID without dashes), like the repair
 * tracking token (lib/repair/stages.ts).
 */

const TOKEN = /^[0-9a-f]{32}$/

export function isValidPawnToken(token: unknown): token is string {
  return typeof token === 'string' && TOKEN.test(token)
}

export function newPawnToken(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

export function pawnTrackingUrl(
  token: string | null | undefined,
  appUrl: string | undefined = process.env.NEXT_PUBLIC_APP_URL,
): string | null {
  if (!isValidPawnToken(token)) return null
  return `${(appUrl ?? '').replace(/\/+$/, '')}/p/${token}`
}
