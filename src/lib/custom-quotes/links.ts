import { isValidPublicToken } from '@/lib/repair/stages'

/** Absolute public quote URL (/q/<token>); null when the link is revoked. */
export function quoteUrl(
  token: string | null | undefined,
  appUrl: string | undefined = process.env.NEXT_PUBLIC_APP_URL,
): string | null {
  if (!isValidPublicToken(token)) return null
  const base = (appUrl ?? '').replace(/\/+$/, '')
  return `${base}/q/${token}`
}
