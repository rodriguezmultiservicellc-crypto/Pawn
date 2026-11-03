import type { ReactNode } from 'react'
import { I18nProvider } from '@/lib/i18n/context'
import { detectLanguageFromHeaders } from '@/lib/i18n/server'

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
  const initialLang = await detectLanguageFromHeaders()
  return (
    <I18nProvider initialLang={initialLang} persistRemote={false}>
      <div className="flex min-h-screen flex-col bg-card">{children}</div>
    </I18nProvider>
  )
}
