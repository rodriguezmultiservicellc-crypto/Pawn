import 'server-only'

import { headers } from 'next/headers'
import type { Language } from './config'

/**
 * Pick the initial language for an UNAUTHENTICATED surface from the
 * Accept-Language header (server-rendered, no client flicker). Used by the
 * (public) layout and by public not-found pages, which render outside the
 * client I18nProvider's reach.
 *
 * Naive but adequate: any es-* lands as 'es', everything else is 'en'.
 * Matches what we promise the customer at sign-up — two languages, simple
 * toggle. A dedicated negotiator would be overkill for two options.
 */
export async function detectLanguageFromHeaders(): Promise<Language> {
  // Next 16 made headers() async.
  const h = await headers()
  const accept = h.get('accept-language')?.toLowerCase() ?? ''
  for (const part of accept.split(',')) {
    const code = part.trim().split(';')[0]
    if (code?.startsWith('es')) return 'es'
    if (code?.startsWith('en')) return 'en'
  }
  return 'en'
}
