'use client'

import { useState } from 'react'
import { Globe, SignOut, User } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { createClient } from '@/lib/supabase/client'

/**
 * Staff top-bar actions: language toggle (EN ↔ ES, persisted to the profile
 * via the I18nProvider), the signed-in user's name, and a Log Out button.
 * Client component — both controls need interactivity. Sign-out clears the
 * Supabase session then hard-navigates to /login so the proxy sees the
 * cleared cookie.
 */
export function StaffTopBarActions({ userName }: { userName: string }) {
  const { t, lang, setLang } = useI18n()
  const [signingOut, setSigningOut] = useState(false)

  async function handleSignOut() {
    if (signingOut) return
    setSigningOut(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.assign('/login')
  }

  return (
    <div className="flex items-center gap-2">
      {/* Language toggle */}
      <button
        type="button"
        onClick={() => setLang(lang === 'en' ? 'es' : 'en')}
        aria-label={lang === 'en' ? 'Cambiar a español' : 'Switch to English'}
        title={lang === 'en' ? 'Español' : 'English'}
        className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-bold text-text-secondary transition-colors hover:bg-background hover:text-foreground"
      >
        <Globe size={16} weight="regular" />
        <span className="uppercase">{lang}</span>
      </button>

      {/* User name */}
      <span className="inline-flex items-center gap-1.5 px-1.5 text-sm font-medium text-text-secondary">
        <User size={16} weight="regular" className="text-muted" />
        <span className="max-w-[16ch] truncate">{userName}</span>
      </span>

      {/* Log out */}
      <button
        type="button"
        onClick={handleSignOut}
        disabled={signingOut}
        className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-sm font-semibold text-text-secondary transition-colors hover:border-danger/40 hover:bg-danger/5 hover:text-danger disabled:opacity-60"
      >
        <SignOut size={16} weight="bold" />
        <span>{t.nav.logOut}</span>
      </button>
    </div>
  )
}
