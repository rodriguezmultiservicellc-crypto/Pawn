import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { getCtx } from '@/lib/supabase/ctx'
import { I18nProvider } from '@/lib/i18n/context'
import { isLanguage } from '@/lib/i18n/config'

/**
 * Superadmin route group. Proxy already gates /admin/* on
 * globalRole='superadmin', but we double-check here against the user-scoped
 * client (defense in depth — proxy reads cookies, this reads the live row).
 */
export default async function AdminLayout({
  children,
}: {
  children: ReactNode
}) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (ctx.globalRole !== 'superadmin') redirect('/no-tenant')

  // Read the user's preferred language to seed I18nProvider.
  const { data: profile } = await ctx.supabase
    .from('profiles')
    .select('language')
    .eq('id', ctx.userId)
    .maybeSingle()

  const initialLang = isLanguage(profile?.language) ? profile.language : 'en'

  return (
    <I18nProvider initialLang={initialLang}>
      <div className="flex min-h-screen flex-col bg-background">
        <header className="border-b border-border bg-card">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            <Link href="/admin/tenants" className="flex items-center gap-2">
              <span
                className="bg-clip-text text-lg font-bold text-transparent"
                style={{
                  backgroundImage:
                    'linear-gradient(90deg, #ff385c 0%, #e00b41 50%, #92174d 100%)',
                }}
              >
                Pawn
              </span>
              <span className="rounded-full bg-navy px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-white">
                Admin
              </span>
            </Link>
            <div className="flex items-center gap-4 text-sm">
              <Link
                href="/admin/tenants"
                className="text-foreground hover:text-gold"
              >
                Tenants
              </Link>
              <Link
                href="/admin/billing"
                className="text-foreground hover:text-gold"
              >
                Billing
              </Link>
              <Link
                href="/admin/watch-models"
                className="text-foreground hover:text-gold"
              >
                Watches
              </Link>
              <Link
                href="/admin/settings"
                className="text-foreground hover:text-gold"
              >
                Settings
              </Link>
              <Link
                href="/dashboard"
                className="rounded-md border border-border px-3 py-1 text-foreground hover:bg-background hover:text-foreground"
                title="Return to the staff workspace for the active tenant"
              >
                Staff →
              </Link>
              <span className="text-muted">{ctx.email}</span>
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
          {children}
        </main>
      </div>
    </I18nProvider>
  )
}
