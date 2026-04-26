import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { getCtx } from '@/lib/supabase/ctx'
import { I18nProvider } from '@/lib/i18n/context'
import { isLanguage } from '@/lib/i18n/config'

/**
 * Customer portal route group. tenantRole='client' only. Defense-in-depth
 * gating — proxy already redirects non-client tenantRole away.
 */
export default async function PortalLayout({
  children,
}: {
  children: ReactNode
}) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (ctx.tenantRole !== 'client') redirect('/no-tenant')

  const { data: profile } = await ctx.supabase
    .from('profiles')
    .select('language, full_name')
    .eq('id', ctx.userId)
    .maybeSingle()

  const initialLang = isLanguage(profile?.language) ? profile.language : 'en'

  return (
    <I18nProvider initialLang={initialLang}>
      <div className="flex min-h-screen flex-col bg-cloud">
        <header className="border-b border-hairline bg-canvas">
          <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
            <Link href="/portal" className="flex items-center gap-2">
              <span
                className="bg-clip-text text-lg font-bold text-transparent"
                style={{
                  backgroundImage:
                    'linear-gradient(90deg, #ff385c 0%, #e00b41 50%, #92174d 100%)',
                }}
              >
                Pawn
              </span>
            </Link>
            <span className="text-sm text-ash">
              {profile?.full_name ?? ctx.email}
            </span>
          </div>
        </header>
        <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">
          {children}
        </main>
      </div>
    </I18nProvider>
  )
}
