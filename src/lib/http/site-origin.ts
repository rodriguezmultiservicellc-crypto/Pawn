import 'server-only'

import { headers } from 'next/headers'

/** This site's address as the browser reached it (for links another device
 *  opens, like the QR handoff). Falls back to NEXT_PUBLIC_APP_URL. */
export async function siteOrigin(): Promise<string> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  if (host) {
    const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
    return `${proto}://${host}`
  }
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3060').replace(/\/+$/, '')
}
