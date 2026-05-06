'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useLangLocal } from '@/lib/i18n/use-lang'

/**
 * Parking page for authenticated users who don't have a tenant role at
 * the active tenant (or have no tenant at all). Lives outside the (auth)
 * group because authenticated users can land here.
 */
export default function NoTenantContent() {
  const { t, lang, setLang } = useLangLocal()
  const router = useRouter()

  async function onSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <div className="flex min-h-screen flex-1 items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-6 rounded-xl border border-border bg-card p-8">
        <div className="space-y-2 text-center">
          <div className="mx-auto h-12 w-12 rounded-full bg-warning/15 text-warning flex items-center justify-center text-2xl font-bold">
            !
          </div>
          <h1 className="text-xl font-semibold text-foreground">
            {t.noTenant.title}
          </h1>
          <p className="text-sm text-muted">{t.noTenant.body}</p>
        </div>
        <div className="flex flex-col items-stretch gap-2">
          <button
            onClick={onSignOut}
            className="w-full rounded-md bg-navy px-4 py-2.5 text-white font-medium"
          >
            {t.noTenant.signOut}
          </button>
          <button
            onClick={() => setLang(lang === 'en' ? 'es' : 'en')}
            className="text-sm text-muted hover:text-foreground"
          >
            {lang === 'en' ? t.lang.es : t.lang.en}
          </button>
        </div>
      </div>
    </div>
  )
}
