import type { ReactNode } from 'react'
import { headers } from 'next/headers'
import { I18nProvider } from '@/lib/i18n/context'
import type { Language } from '@/lib/i18n/config'

/**
 * (public) route group — unauthenticated marketing surface.
 *
 * Wraps children in I18nProvider with persistRemote=false so the
 * language toggle writes only to localStorage. There's no logged-in
 * user, so /api/profile/language would 401 silently — skip it.
 *
 * Initial language sniffs the Accept-Language header (server-rendered,
 * no client flicker). The toggle component on the client takes over
 * from there.
 */
export default async function PublicLayout({
  children,
}: {
  children: ReactNode
}) {
  const initialLang = await detectInitialLanguage()
  return (
    <I18nProvider initialLang={initialLang} persistRemote={false}>
      <div className="flex min-h-screen flex-col bg-card">{children}</div>
    </I18nProvider>
  )
}

async function detectInitialLanguage(): Promise<Language> {
  // Next 16 made headers() async.
  const h = await headers()
  const accept = h.get('accept-language')?.toLowerCase() ?? ''
  // Naive but adequate: any es-* lands as 'es', everything else is 'en'.
  // Matches what we promise the customer at sign-up — two languages, simple
  // toggle. A dedicated negotiator would be overkill for two options.
  for (const part of accept.split(',')) {
    const code = part.trim().split(';')[0]
    if (code?.startsWith('es')) return 'es'
    if (code?.startsWith('en')) return 'en'
  }
  return 'en'
}
